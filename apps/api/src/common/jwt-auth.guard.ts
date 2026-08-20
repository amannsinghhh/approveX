import { createHash } from 'node:crypto';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthUser } from './auth.types';
import { env } from './env';
import { IS_PUBLIC_KEY } from './decorators';

interface AccessTokenPayload {
  sub: string;
  tenantId: string;
  email: string;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;
    if (!token) throw new UnauthorizedException('Missing bearer token');

    if (token.startsWith('ax_')) {
      req.user = await this.authenticateApiKey(token);
      return true;
    }

    try {
      const payload = await this.jwt.verifyAsync<AccessTokenPayload>(token, {
        secret: env.jwtAccessSecret,
      });
      req.user = { userId: payload.sub, tenantId: payload.tenantId, email: payload.email };
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }

  /**
   * `ax_...` bearer tokens are API keys: sha256 lookup (owner connection —
   * authentication happens before any tenant context exists). The principal's
   * userId is the key's uuid, which never collides with a user — so
   * maker-checker, "creator", and audit attribution all hold.
   */
  private async authenticateApiKey(token: string): Promise<AuthUser> {
    const keyHash = createHash('sha256').update(token).digest('hex');
    const apiKey = await this.prisma.apiKey.findUnique({ where: { keyHash } });
    if (!apiKey || apiKey.revokedAt) throw new UnauthorizedException('Invalid API key');

    // last_used_at is telemetry — throttle to one write per minute per key.
    if (!apiKey.lastUsedAt || Date.now() - apiKey.lastUsedAt.getTime() > 60_000) {
      await this.prisma.apiKey
        .update({ where: { id: apiKey.id }, data: { lastUsedAt: new Date() } })
        .catch(() => undefined);
    }

    return {
      userId: apiKey.id,
      tenantId: apiKey.tenantId,
      email: `api-key:${apiKey.name}`,
      apiKey: { id: apiKey.id, name: apiKey.name, scopes: apiKey.scopes },
    };
  }
}
