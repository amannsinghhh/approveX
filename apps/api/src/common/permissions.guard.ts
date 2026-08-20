import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import type { ApiKeyScope, AuthUser, PermissionKey } from './auth.types';
import { API_KEY_SCOPES_KEY, PERMISSIONS_KEY } from './decorators';

/**
 * Enforces @RequirePermissions(...). Loads the user's effective permission set
 * through the RLS-scoped client, so a token forged for another tenant resolves
 * to no user at all. Also rejects deactivated users.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tenantPrisma: TenantPrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<PermissionKey[] | undefined>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    const req = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const user = req.user;
    if (!user) return !required || required.length === 0; // public route

    // API keys have scopes, not roles. Only routes that explicitly opted in
    // via @ApiKeyScopes(...) accept them — everything else fails closed.
    if (user.apiKey) {
      const allowed = this.reflector.getAllAndOverride<ApiKeyScope[] | undefined>(
        API_KEY_SCOPES_KEY,
        [context.getHandler(), context.getClass()],
      );
      if (!allowed || allowed.length === 0) {
        throw new ForbiddenException('API keys cannot access this endpoint');
      }
      const held = new Set(user.apiKey.scopes);
      if (!allowed.some((scope) => held.has(scope))) {
        throw new ForbiddenException(
          `API key is missing a required scope (${allowed.join(' or ')})`,
        );
      }
      user.permissions = [];
      return true;
    }

    const dbUser = await this.tenantPrisma.forTenant(user.tenantId).user.findFirst({
      where: { id: user.userId, status: 'active' },
      select: {
        userRoles: {
          select: {
            role: {
              select: {
                rolePermissions: { select: { permission: { select: { key: true } } } },
              },
            },
          },
        },
      },
    });
    if (!dbUser) throw new UnauthorizedException('User is not active');

    const held = new Set(
      dbUser.userRoles.flatMap((ur) => ur.role.rolePermissions.map((rp) => rp.permission.key)),
    );
    user.permissions = [...held];

    const missing = (required ?? []).filter((perm) => !held.has(perm));
    if (missing.length > 0) {
      throw new ForbiddenException(`Missing permission: ${missing.join(', ')}`);
    }
    return true;
  }
}
