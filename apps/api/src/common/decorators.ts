import type { ExecutionContext } from '@nestjs/common';
import { createParamDecorator, SetMetadata } from '@nestjs/common';
import type { Request } from 'express';
import type { ApiKeyScope, AuthUser, PermissionKey } from './auth.types';

export const IS_PUBLIC_KEY = 'isPublic';
/** Skips JWT authentication for this route (health, signup, login, ...). */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);

export const PERMISSIONS_KEY = 'requiredPermissions';
/** Requires the current user to hold every listed permission. */
export const RequirePermissions = (
  ...permissions: PermissionKey[]
): MethodDecorator & ClassDecorator => SetMetadata(PERMISSIONS_KEY, permissions);

export const API_KEY_SCOPES_KEY = 'allowedApiKeyScopes';
/**
 * Opts this route in for API-key callers holding ANY of the listed scopes.
 * Routes without this decorator reject API keys entirely (fail closed).
 */
export const ApiKeyScopes = (...scopes: ApiKeyScope[]): MethodDecorator & ClassDecorator =>
  SetMetadata(API_KEY_SCOPES_KEY, scopes);

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const req = ctx.switchToHttp().getRequest<Request & { user: AuthUser }>();
    return req.user;
  },
);
