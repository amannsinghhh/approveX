import { signWebhookPayload, webhookNextAttemptAt } from '../../../../shared/src/index';
import type { PrismaClient } from '@prisma/client';

/**
 * Outbox delivery (principle #5). Claiming and delivering are separate so no
 * HTTP call ever runs inside a DB transaction:
 *
 *  1. One atomic UPDATE claims due rows (`pending` past next_attempt_at, plus
 *     `delivering` rows whose 5-minute lease expired — a crashed worker's
 *     claims are recovered). FOR UPDATE SKIP LOCKED keeps concurrent workers
 *     from double-claiming.
 *  2. Each claimed row is POSTed with the HMAC signature headers.
 *  3. A final UPDATE records the outcome: delivered, retry per the shared
 *     backoff schedule (1m/5m/30m/2h/12h), or dead_letter when exhausted.
 */

interface ClaimedRow {
  id: string;
  tenantId: string;
  endpointId: string | null;
  url: string;
  eventType: string;
  payload: unknown;
  attempts: number;
}

export interface DeliveryStats {
  claimed: number;
  delivered: number;
  retried: number;
  deadLettered: number;
}

const REQUEST_TIMEOUT_MS = 10_000;
const BATCH_SIZE = 25;

export async function deliverDueWebhooks(
  prisma: PrismaClient,
  fetchImpl: typeof fetch = fetch,
): Promise<DeliveryStats> {
  // next_attempt_at gets a 2s grace: Prisma fills @default(now()) from the
  // CLIENT clock, which can run ahead of Postgres's now() (milliseconds on one
  // host, more across hosts) — without it, freshly enqueued rows can be "not
  // due yet" at the moment they commit. Delivering 2s early is harmless.
  const rows = await prisma.$queryRaw<ClaimedRow[]>`
    UPDATE webhook_outbox SET status = 'delivering', locked_at = now(), updated_at = now()
    WHERE id IN (
      SELECT id FROM webhook_outbox
      WHERE (status = 'pending' AND next_attempt_at <= now() + interval '2 seconds')
         OR (status = 'delivering' AND locked_at < now() - interval '5 minutes')
      ORDER BY next_attempt_at ASC
      LIMIT ${BATCH_SIZE}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, tenant_id AS "tenantId", endpoint_id AS "endpointId", url,
              event_type AS "eventType", payload, attempts
  `;
  const stats: DeliveryStats = { claimed: rows.length, delivered: 0, retried: 0, deadLettered: 0 };
  if (rows.length === 0) return stats;

  const tenants = await prisma.tenant.findMany({
    where: { id: { in: [...new Set(rows.map((row) => row.tenantId))] } },
    select: { id: true, webhookSecret: true },
  });
  const secretByTenant = new Map(tenants.map((tenant) => [tenant.id, tenant.webhookSecret]));

  for (const row of rows) {
    const secret = secretByTenant.get(row.tenantId);
    if (!secret) continue; // tenant vanished — lease will expire and retry

    const attempt = row.attempts + 1;
    const body = JSON.stringify({
      deliveryId: row.id,
      attempt,
      ...(row.payload as Record<string, unknown>),
    });

    let failure: { error: string; statusCode: number | null } | null = null;
    let statusCode: number | null = null;
    try {
      const res = await fetchImpl(row.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'user-agent': 'ApproveX-Webhooks/1.0',
          'x-approvex-signature': signWebhookPayload(secret, body),
          'x-approvex-event': row.eventType,
          'x-approvex-delivery-id': row.id,
        },
        body,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      statusCode = res.status;
      if (!res.ok) failure = { error: `HTTP ${res.status}`, statusCode: res.status };
    } catch (err) {
      failure = { error: err instanceof Error ? err.message : String(err), statusCode: null };
    }

    if (!failure) {
      await prisma.webhookOutbox.update({
        where: { id: row.id },
        data: {
          status: 'delivered',
          attempts: attempt,
          deliveredAt: new Date(),
          lastStatusCode: statusCode,
          lastError: null,
          lockedAt: null,
        },
      });
      stats.delivered += 1;
      continue;
    }

    const nextAttemptAt = webhookNextAttemptAt(attempt);
    if (nextAttemptAt) {
      await prisma.webhookOutbox.update({
        where: { id: row.id },
        data: {
          status: 'pending',
          attempts: attempt,
          nextAttemptAt,
          lastError: failure.error.slice(0, 500),
          lastStatusCode: failure.statusCode,
          lockedAt: null,
        },
      });
      stats.retried += 1;
    } else {
      await prisma.webhookOutbox.update({
        where: { id: row.id },
        data: {
          status: 'dead_letter',
          attempts: attempt,
          lastError: failure.error.slice(0, 500),
          lastStatusCode: failure.statusCode,
          lockedAt: null,
        },
      });
      await prisma.auditEvent.create({
        data: {
          tenantId: row.tenantId,
          actorType: 'system',
          eventType: 'webhook.dead_lettered',
          entityType: 'webhook_outbox',
          entityId: row.id,
          after: {
            url: row.url,
            event: row.eventType,
            attempts: attempt,
            lastError: failure.error.slice(0, 500),
          },
        },
      });
      stats.deadLettered += 1;
    }
  }
  return stats;
}
