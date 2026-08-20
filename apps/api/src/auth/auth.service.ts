import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { AuditService } from '../audit/audit.service';
import { env } from '../common/env';
import { PrismaService } from '../prisma/prisma.service';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import type { LoginDto, RefreshDto, SignupDto } from './auth.schemas';

interface RefreshTokenPayload {
  sub: string;
  tenantId: string;
  jti: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

const slugify = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
  ) {}

  /** Creates tenant + Admin role (all permissions) + first user, atomically. */
  async signup(dto: SignupDto, ip?: string) {
    const slug = dto.slug ?? slugify(dto.tenantName);
    if (!slug) throw new ConflictException('Could not derive a slug from the tenant name');

    const [existingSlug, existingEmail] = await Promise.all([
      this.prisma.tenant.findUnique({ where: { slug } }),
      this.prisma.user.findUnique({ where: { email: dto.email } }),
    ]);
    if (existingSlug) throw new ConflictException('Slug is already taken');
    if (existingEmail) throw new ConflictException('Email is already registered');

    const passwordHash = await argon2.hash(dto.password);

    const { tenant, user } = await this.prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          name: dto.tenantName,
          slug,
          webhookSecret: randomBytes(32).toString('hex'),
        },
      });

      const permissions = await tx.permission.findMany({ select: { id: true } });
      const adminRole = await tx.role.create({
        data: {
          tenantId: tenant.id,
          name: 'Admin',
          description: 'Full access (created at signup)',
          isSystem: true,
          rolePermissions: {
            create: permissions.map((perm) => ({
              permissionId: perm.id,
              tenantId: tenant.id,
            })),
          },
        },
      });

      const user = await tx.user.create({
        data: {
          tenantId: tenant.id,
          email: dto.email,
          name: dto.name,
          passwordHash,
          status: 'active',
          userRoles: { create: { roleId: adminRole.id, tenantId: tenant.id } },
        },
      });

      return { tenant, user };
    });

    await this.audit.record({
      tenantId: tenant.id,
      actorUserId: user.id,
      eventType: 'tenant.created',
      entityType: 'tenant',
      entityId: tenant.id,
      after: { name: tenant.name, slug: tenant.slug },
      ip,
    });

    const tokens = await this.issueTokens(user.id, tenant.id, dto.email);
    return {
      tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug },
      user: { id: user.id, email: user.email, name: user.name },
      ...tokens,
    };
  }

  async login(dto: LoginDto, ip?: string) {
    // Owner connection: login happens before any tenant context exists.
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    const valid = user && (await argon2.verify(user.passwordHash, dto.password));
    if (!valid || user.status !== 'active') {
      throw new UnauthorizedException('Invalid email or password');
    }

    await this.audit.record({
      tenantId: user.tenantId,
      actorUserId: user.id,
      eventType: 'auth.login',
      entityType: 'user',
      entityId: user.id,
      ip,
    });

    const tokens = await this.issueTokens(user.id, user.tenantId, user.email);
    return {
      user: { id: user.id, email: user.email, name: user.name },
      tenantId: user.tenantId,
      ...tokens,
    };
  }

  /** SSO login for an EXISTING active user (OIDC never provisions accounts). */
  async loginOidc(email: string, provider: string, ip?: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || user.status !== 'active') {
      throw new UnauthorizedException(
        'No active account for this email — ask an admin to invite you first',
      );
    }

    await this.audit.record({
      tenantId: user.tenantId,
      actorUserId: user.id,
      eventType: 'auth.login',
      entityType: 'user',
      entityId: user.id,
      after: { method: 'oidc', provider },
      ip,
    });

    const tokens = await this.issueTokens(user.id, user.tenantId, user.email);
    return {
      user: { id: user.id, email: user.email, name: user.name },
      tenantId: user.tenantId,
      ...tokens,
    };
  }

  /** Rotates the refresh token: the presented one is revoked, a new pair is issued. */
  async refresh(dto: RefreshDto) {
    const payload = await this.verifyRefreshToken(dto.refreshToken);
    const client = this.tenantPrisma.forTenant(payload.tenantId);

    const stored = await client.refreshToken.findUnique({
      where: { jtiHash: sha256(payload.jti) },
    });
    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token is no longer valid');
    }

    const user = await client.user.findFirst({
      where: { id: payload.sub, status: 'active' },
    });
    if (!user) throw new UnauthorizedException('User is not active');

    await client.refreshToken.update({
      where: { jtiHash: sha256(payload.jti) },
      data: { revokedAt: new Date() },
    });

    return this.issueTokens(user.id, user.tenantId, user.email);
  }

  async logout(userId: string, tenantId: string, dto: RefreshDto): Promise<void> {
    const payload = await this.verifyRefreshToken(dto.refreshToken);
    if (payload.sub !== userId || payload.tenantId !== tenantId) {
      throw new UnauthorizedException('Refresh token does not belong to this user');
    }
    await this.tenantPrisma.forTenant(tenantId).refreshToken.updateMany({
      where: { jtiHash: sha256(payload.jti), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async verifyRefreshToken(token: string): Promise<RefreshTokenPayload> {
    try {
      return await this.jwt.verifyAsync<RefreshTokenPayload>(token, {
        secret: env.jwtRefreshSecret,
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
  }

  private async issueTokens(userId: string, tenantId: string, email: string): Promise<TokenPair> {
    const jti = randomUUID();
    const expiresAt = new Date(Date.now() + env.refreshTtlDays * 24 * 60 * 60 * 1000);

    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAsync(
        { sub: userId, tenantId, email },
        { secret: env.jwtAccessSecret, expiresIn: env.accessTtlSeconds },
      ),
      this.jwt.signAsync(
        { sub: userId, tenantId, jti },
        { secret: env.jwtRefreshSecret, expiresIn: env.refreshTtlDays * 86400 },
      ),
    ]);

    await this.tenantPrisma.forTenant(tenantId).refreshToken.create({
      data: { tenantId, userId, jtiHash: sha256(jti), expiresAt },
    });

    return { accessToken, refreshToken };
  }
}
