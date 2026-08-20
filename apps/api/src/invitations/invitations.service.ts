import { createHash, randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import { AuditService } from '../audit/audit.service';
import type { AcceptInvitationDto } from '../auth/auth.schemas';
import { PrismaService } from '../prisma/prisma.service';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import type { CreateInvitationDto } from './invitations.schemas';

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');
const INVITATION_TTL_DAYS = 7;

@Injectable()
export class InvitationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Returns the raw token exactly once — email delivery arrives in Phase 6. */
  async create(tenantId: string, actorUserId: string, dto: CreateInvitationDto) {
    const client = this.tenantPrisma.forTenant(tenantId);

    // Emails are globally unique in MVP (one tenant per user).
    const existingUser = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existingUser) throw new ConflictException('Email is already registered');

    const roles = await client.role.findMany({ where: { id: { in: dto.roleIds } } });
    if (roles.length !== dto.roleIds.length) {
      throw new BadRequestException('One or more roles do not exist');
    }

    const token = randomBytes(32).toString('base64url');
    const invitation = await client.invitation.create({
      data: {
        tenantId,
        email: dto.email,
        roleIds: dto.roleIds,
        tokenHash: sha256(token),
        expiresAt: new Date(Date.now() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000),
        invitedById: actorUserId,
      },
    });

    return {
      id: invitation.id,
      email: invitation.email,
      roleIds: invitation.roleIds,
      status: invitation.status,
      expiresAt: invitation.expiresAt,
      token, // shown once; only the hash is stored
    };
  }

  async list(tenantId: string) {
    const items = await this.tenantPrisma.forTenant(tenantId).invitation.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        email: true,
        roleIds: true,
        status: true,
        expiresAt: true,
        invitedById: true,
        createdAt: true,
      },
    });
    return { items };
  }

  async revoke(tenantId: string, invitationId: string): Promise<{ id: string; status: string }> {
    const client = this.tenantPrisma.forTenant(tenantId);
    const invitation = await client.invitation.findUnique({ where: { id: invitationId } });
    if (!invitation) throw new NotFoundException('Invitation not found');
    if (invitation.status !== 'pending') {
      throw new ConflictException(`Invitation is already ${invitation.status}`);
    }
    const updated = await client.invitation.update({
      where: { id: invitationId },
      data: { status: 'revoked' },
    });
    return { id: updated.id, status: updated.status };
  }

  /** Public flow — token is the only credential, so lookup uses the owner connection. */
  async accept(dto: AcceptInvitationDto, ip?: string) {
    const invitation = await this.prisma.invitation.findUnique({
      where: { tokenHash: sha256(dto.token) },
    });
    if (!invitation || invitation.status !== 'pending') {
      throw new BadRequestException('Invitation is invalid or no longer active');
    }
    if (invitation.expiresAt < new Date()) {
      await this.prisma.invitation.update({
        where: { id: invitation.id },
        data: { status: 'expired' },
      });
      throw new BadRequestException('Invitation has expired');
    }

    const existingUser = await this.prisma.user.findUnique({
      where: { email: invitation.email },
    });
    if (existingUser) throw new ConflictException('Email is already registered');

    const passwordHash = await argon2.hash(dto.password);

    const user = await this.tenantPrisma.transactionForTenant(invitation.tenantId, async (tx) => {
      // Roles may have been deleted since the invite went out — keep the survivors.
      const roles = await tx.role.findMany({
        where: { id: { in: invitation.roleIds } },
        select: { id: true },
      });
      const user = await tx.user.create({
        data: {
          tenantId: invitation.tenantId,
          email: invitation.email,
          name: dto.name,
          passwordHash,
          status: 'active',
          userRoles: {
            create: roles.map((role) => ({ roleId: role.id, tenantId: invitation.tenantId })),
          },
        },
      });
      await tx.invitation.update({
        where: { id: invitation.id },
        data: { status: 'accepted' },
      });
      return user;
    });

    await this.audit.record({
      tenantId: invitation.tenantId,
      actorUserId: user.id,
      eventType: 'invitation.accepted',
      entityType: 'invitation',
      entityId: invitation.id,
      after: { email: invitation.email, userId: user.id },
      ip,
    });

    return { user: { id: user.id, email: user.email, name: user.name }, tenantId: user.tenantId };
  }
}
