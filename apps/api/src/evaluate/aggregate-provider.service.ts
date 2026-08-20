import { Injectable } from '@nestjs/common';
import type { AggregateRef, EvalContext } from '@approvex/shared';
import { resolvePath, windowStartMs } from '@approvex/shared';
import type { Prisma } from '@prisma/client';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { RedisService } from '../redis/redis.service';

/**
 * Cache TTL for computed aggregates. Deliberately short (test scenario 17:
 * TTL ≪ smallest window of 1 day): request history changes on every execute,
 * so unlike rules/fields there is no invalidation hook — staleness is bounded
 * by the TTL alone. 60s keeps the evaluation hot path off Postgres for bursty
 * traffic without letting velocity counts drift meaningfully.
 */
const TTL_SECONDS = 60;

const cacheKey = (tenantId: string, refKey: string): string => `agg:${tenantId}:${refKey}`;

/** "items[0].vendor.id" → ["items", "0", "vendor", "id"] for Prisma's Json path filter. */
const jsonPath = (field: string): string[] =>
  field.split('.').flatMap((segment) => segment.split(/[[\]]/).filter((part) => part !== ''));

/**
 * Computes the aggregate values a rule set needs (B.3 #5/#6) over the tenant's
 * request history: COUNT of requests in the window whose payload shares the
 * grouping value, or SUM of a payload field over those rows. Cancelled
 * requests never count toward velocity (scenario 17). Values are injected
 * into the evaluator via EvaluateOptions.aggregates, keyed by aggregateKey();
 * a value this provider cannot supply fails closed in the evaluator
 * (`missing_aggregate`), never open.
 */
@Injectable()
export class AggregateProviderService {
  constructor(
    private readonly redis: RedisService,
    private readonly tenantPrisma: TenantPrismaService,
  ) {}

  async getAggregates(
    tenantId: string,
    refs: AggregateRef[],
    context: EvalContext,
  ): Promise<Record<string, number>> {
    const entries = await Promise.all(
      refs.map(async (ref): Promise<[string, number]> => {
        const key = cacheKey(tenantId, ref.key);
        const cached = await this.redis.getJson<number>(key);
        if (typeof cached === 'number') return [ref.key, cached];

        const value = await this.compute(tenantId, ref, context);
        await this.redis.setJson(key, value, TTL_SECONDS);
        return [ref.key, value];
      }),
    );
    return Object.fromEntries(entries);
  }

  private async compute(
    tenantId: string,
    ref: AggregateRef,
    context: EvalContext,
  ): Promise<number> {
    const since = new Date(windowStartMs(ref.window, context));
    const where: Prisma.RequestWhereInput = {
      createdAt: { gte: since },
      status: { not: 'cancelled' },
      payload: {
        path: jsonPath(ref.field),
        equals: ref.groupValue as Prisma.InputJsonValue,
      },
    };
    const client = this.tenantPrisma.forTenant(tenantId);

    if (ref.kind === 'count') {
      return client.request.count({ where });
    }

    // SUM: Prisma cannot aggregate a jsonb path, and the sum field resolution
    // must match the evaluator's (dot + [index] via resolvePath) — fetch the
    // window's payloads and sum in process. Windows are per-group and bounded.
    const rows = await client.request.findMany({ where, select: { payload: true } });
    let sum = 0;
    for (const row of rows) {
      const resolved = resolvePath(row.payload, ref.sumField ?? '');
      if (resolved.found && typeof resolved.value === 'number' && !Number.isNaN(resolved.value)) {
        sum += resolved.value;
      }
    }
    return sum;
  }
}
