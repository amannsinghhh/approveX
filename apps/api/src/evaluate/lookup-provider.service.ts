import { createHash } from 'node:crypto';
import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import type { FieldSchema, LookupFallbackBehavior } from '@approvex/shared';
import { fieldMetaOf } from '@approvex/shared';
import { RedisService } from '../redis/redis.service';

/**
 * Outbound budget per lookup call (B.3 #10, test scenario 20): a slow lookup
 * endpoint must degrade via fallback_behavior, never stall the evaluate path.
 */
const TIMEOUT_MS = 2000;

/**
 * How long a successful lookup stays available to `use_cached_value`. This is
 * a *fallback* store, not a read-through cache — every evaluation attempts a
 * fresh fetch first, so staleness only shows when the endpoint is down.
 */
const CACHE_TTL_SECONDS = 3600;

/** Cache key is per tenant + field + request payload identity. */
const cacheKey = (tenantId: string, field: string, payload: unknown): string => {
  const digest = createHash('sha256')
    .update(JSON.stringify(payload) ?? 'null')
    .digest('hex')
    .slice(0, 32);
  return `lookup:${tenantId}:${field}:${digest}`;
};

/**
 * Resolves `source: looked_up` fields (B.3 #10) by calling each field's
 * registered lookupUrl with the evaluation payload. Results are injected into
 * the evaluator via EvaluateOptions.lookups; a field this provider cannot
 * supply fails closed in the evaluator (`missing_lookup`), never open.
 *
 * Failure handling per the field's fallback_behavior:
 * - treat_as_no_match  → key omitted; comparisons on the field fail closed.
 * - use_cached_value   → last successful value for the same payload (Redis);
 *                        if none exists, behaves like treat_as_no_match.
 * - block_and_alert    → the whole evaluation is refused (503) and the
 *                        failure logged — never a silent pass.
 */
@Injectable()
export class LookupProviderService {
  private readonly logger = new Logger(LookupProviderService.name);

  constructor(private readonly redis: RedisService) {}

  async getLookups(
    tenantId: string,
    fields: string[],
    schema: FieldSchema,
    payload: unknown,
  ): Promise<Record<string, unknown>> {
    const lookups: Record<string, unknown> = {};
    await Promise.all(
      fields.map(async (field) => {
        const meta = fieldMetaOf(schema, field);
        if (!meta?.lookupUrl) return; // misconfigured → fail closed downstream
        const fallback: LookupFallbackBehavior = meta.lookupFallback ?? 'treat_as_no_match';
        const key = cacheKey(tenantId, field, payload);

        try {
          const value = await this.fetchValue(meta.lookupUrl, field, payload);
          lookups[field] = value;
          await this.redis.setJson(key, { value }, CACHE_TTL_SECONDS);
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          if (fallback === 'block_and_alert') {
            this.logger.error(
              `Lookup for "${field}" (tenant ${tenantId}) failed with block_and_alert: ${reason}`,
            );
            throw new ServiceUnavailableException(
              `Lookup for field "${field}" failed and the field is configured to block evaluation`,
            );
          }
          if (fallback === 'use_cached_value') {
            const cached = await this.redis.getJson<{ value: unknown }>(key);
            if (cached && typeof cached === 'object' && 'value' in cached) {
              this.logger.warn(`Lookup for "${field}" failed (${reason}); using cached value`);
              lookups[field] = cached.value;
              return;
            }
          }
          // treat_as_no_match (or an empty cache): omit the key; the
          // evaluator fails the comparison closed with `missing_lookup`.
          this.logger.warn(`Lookup for "${field}" failed (${reason}); treating as no-match`);
        }
      }),
    );
    return lookups;
  }

  /** POSTs { field, payload } to the lookup endpoint; expects JSON back. */
  private async fetchValue(url: string, field: string, payload: unknown): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ field, payload }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`lookup endpoint returned ${res.status}`);
      const body: unknown = await res.json();
      // Convention: { value: ... } envelope, or the bare JSON value itself.
      if (body && typeof body === 'object' && 'value' in body) {
        return (body as { value: unknown }).value;
      }
      return body;
    } finally {
      clearTimeout(timer);
    }
  }
}
