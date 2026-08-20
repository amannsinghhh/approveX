import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import type { Request } from 'express';
import type { Observable } from 'rxjs';
import { mergeMap } from 'rxjs/operators';
import type { AuthUser } from '../common/auth.types';
import { AuditService } from './audit.service';

const MUTATING_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);
const VERB_BY_METHOD: Record<string, string> = {
  POST: 'created',
  PATCH: 'updated',
  PUT: 'updated',
  DELETE: 'deleted',
};

/**
 * Logs every successful mutating endpoint call as an audit event. Auth routes
 * are skipped — AuthService records richer domain events (auth.login,
 * tenant.created, ...) itself.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly audit: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const user = req.user;

    // Auth flows and /evaluate write their own richer events (and a dry run
    // must not leave generic noise — spec §5).
    if (
      !user ||
      !MUTATING_METHODS.has(req.method) ||
      req.path.startsWith('/api/v1/auth') ||
      req.path.startsWith('/api/v1/evaluate')
    ) {
      return next.handle();
    }

    // /api/v1/roles/123 → roles.updated on entity 123
    // /api/v1/rules/123/publish → rules.publish on entity 123
    const segments = req.path
      .replace(/^\/api\/v1\//, '')
      .split('/')
      .filter(Boolean);
    const resource = segments[0] ?? 'unknown';
    const entityId = segments[1] && segments[1].length > 0 ? segments[1] : null;
    const action = segments[2];
    const verb = action ?? VERB_BY_METHOD[req.method] ?? req.method.toLowerCase();

    return next.handle().pipe(
      mergeMap(async (data) => {
        await this.audit.record({
          tenantId: user.tenantId,
          actorUserId: user.userId,
          actorType: user.apiKey ? 'api_key' : 'user',
          eventType: `${resource}.${verb}`,
          entityType: resource,
          entityId,
          after: req.body,
          ip: req.ip,
        });
        return data;
      }),
    );
  }
}
