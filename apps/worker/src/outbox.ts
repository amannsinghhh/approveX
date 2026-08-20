import type { WebhookEventType } from '@approvex/shared';
import type { Prisma } from '@prisma/client';

type Db = Prisma.TransactionClient;

/**
 * Worker-side outbox enqueue (mirrors the API's OutboxService): fans an event
 * out to the tenant's enabled, subscribed endpoints inside the caller's
 * transaction. The worker runs on the owner connection, so the tenant filter
 * here is explicit — never drop it.
 */
export async function enqueueOutbox(
  db: Db,
  tenantId: string,
  eventType: WebhookEventType,
  data: Record<string, unknown>,
): Promise<number> {
  const endpoints = await db.webhookEndpoint.findMany({
    where: {
      tenantId,
      enabled: true,
      OR: [{ events: { isEmpty: true } }, { events: { has: eventType } }],
    },
  });
  if (endpoints.length === 0) return 0;
  const payload = {
    event: eventType,
    occurredAt: new Date().toISOString(),
    data,
  } as unknown as Prisma.InputJsonValue;
  await db.webhookOutbox.createMany({
    data: endpoints.map((endpoint) => ({
      tenantId,
      endpointId: endpoint.id,
      url: endpoint.url,
      eventType,
      payload,
    })),
  });
  return endpoints.length;
}
