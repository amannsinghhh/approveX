import type { WebhookEventType } from '@approvex/shared';
import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

type Tx = Prisma.TransactionClient;

/**
 * Transactional outbox writer (principle #5): rows are created in the SAME
 * transaction as the state change they announce — never an HTTP call in a
 * transaction. The worker (apps/worker) delivers them with signed payloads
 * and exponential backoff.
 */
@Injectable()
export class OutboxService {
  /**
   * Fans `eventType` out to every enabled endpoint subscribed to it (an empty
   * `events` array means "everything"), plus an optional inline URL — used by
   * workflow webhook_call nodes that target a URL directly.
   */
  async enqueue(
    tx: Tx,
    tenantId: string,
    eventType: WebhookEventType,
    data: Record<string, unknown>,
    options: { inlineUrl?: string; endpointId?: string } = {},
  ): Promise<number> {
    const payload = {
      event: eventType,
      occurredAt: new Date().toISOString(),
      data,
    } as unknown as Prisma.InputJsonValue;

    const endpoints = options.endpointId
      ? await tx.webhookEndpoint.findMany({ where: { id: options.endpointId, enabled: true } })
      : await tx.webhookEndpoint.findMany({
          where: {
            enabled: true,
            OR: [{ events: { isEmpty: true } }, { events: { has: eventType } }],
          },
        });

    const rows: Prisma.WebhookOutboxCreateManyInput[] = endpoints.map((endpoint) => ({
      tenantId,
      endpointId: endpoint.id,
      url: endpoint.url,
      eventType,
      payload,
    }));
    if (options.inlineUrl) {
      rows.push({ tenantId, endpointId: null, url: options.inlineUrl, eventType, payload });
    }
    if (rows.length === 0) return 0;
    await tx.webhookOutbox.createMany({ data: rows });
    return rows.length;
  }

  /** Enqueue with the standard request snapshot as the event body. */
  async enqueueForRequest(
    tx: Tx,
    tenantId: string,
    eventType: WebhookEventType,
    requestId: string,
    extra: Record<string, unknown> = {},
    options: { inlineUrl?: string } = {},
  ): Promise<number> {
    const request = await tx.request.findUniqueOrThrow({
      where: { id: requestId },
      select: {
        id: true,
        externalRef: true,
        context: true,
        title: true,
        status: true,
        payload: true,
        matchedRuleVersionId: true,
        workflowVersionId: true,
        createdById: true,
        createdAt: true,
        completedAt: true,
      },
    });
    return this.enqueue(
      tx,
      tenantId,
      eventType,
      {
        request: {
          ...request,
          createdAt: request.createdAt.toISOString(),
          completedAt: request.completedAt?.toISOString() ?? null,
        },
        ...extra,
      },
      options,
    );
  }
}
