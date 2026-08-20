import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { HttpException, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { RedisService } from '../redis/redis.service';
import type { AuthUser } from './auth.types';

export const RATE_LIMITED_KEY = 'rateLimited';
/** Marks a route for per-tenant rate limiting (the machine-facing API). */
export const RateLimited = (): MethodDecorator & ClassDecorator =>
  SetMetadata(RATE_LIMITED_KEY, true);

/**
 * Per-tenant sliding-window rate limit over Redis (spec Phase 6). One window
 * covers all rate-limited routes: RATE_LIMIT_RPM requests per rolling minute
 * (default 300). Redis down ⇒ fail OPEN — availability of the customer's
 * approval flow beats limiter precision, matching RedisService's cache
 * degradation policy.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly redis: RedisService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const limited = this.reflector.getAllAndOverride<boolean>(RATE_LIMITED_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!limited) return true;

    const req = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const user = req.user;
    if (!user) return true; // public routes are never rate-limited here

    const limit = Number(process.env.RATE_LIMIT_RPM ?? 300);
    if (!Number.isFinite(limit) || limit <= 0) return true;

    const res = context.switchToHttp().getResponse<Response>();
    const key = `rl:${user.tenantId}`;
    const now = Date.now();
    const windowMs = 60_000;

    try {
      const pipeline = this.redis.client
        .pipeline()
        .zremrangebyscore(key, 0, now - windowMs)
        .zadd(key, now, `${now}:${Math.random().toString(36).slice(2)}`)
        .zcard(key)
        .pexpire(key, windowMs);
      const results = await pipeline.exec();
      const count = Number(results?.[2]?.[1] ?? 0);

      res.setHeader('X-RateLimit-Limit', String(limit));
      res.setHeader('X-RateLimit-Remaining', String(Math.max(limit - count, 0)));

      if (count > limit) {
        const oldest = await this.redis.client.zrange(key, 0, 0, 'WITHSCORES');
        const oldestAt = Number(oldest[1] ?? now);
        const retryAfter = Math.max(Math.ceil((oldestAt + windowMs - now) / 1000), 1);
        res.setHeader('Retry-After', String(retryAfter));
        throw new HttpException(
          { statusCode: 429, message: 'Rate limit exceeded. Slow down and retry.' },
          429,
        );
      }
      return true;
    } catch (err) {
      if (err instanceof HttpException) throw err;
      return true; // Redis unavailable — fail open
    }
  }
}
