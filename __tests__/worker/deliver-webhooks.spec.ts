import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { verifyWebhookSignature } from '../../shared/src/index';
import type { Prisma, PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrisma } from '../../apps/worker/src/db';
import { deliverDueWebhooks } from '../../apps/worker/src/processors/deliver-webhooks';
import { seedTenant } from './seed';

interface CapturedRequest {
  headers: IncomingMessage['headers'];
  body: string;
}

describe('webhook outbox delivery', () => {
  let prisma: PrismaClient;
  let server: Server;
  let baseUrl: string;
  let responseCode = 200;
  const captured: CapturedRequest[] = [];

  beforeAll(async () => {
    prisma = createPrisma();
    // Delivery claims a global batch ordered by next_attempt_at — leftover
    // rows from an earlier run would fill it and starve this suite's rows.
    await prisma.webhookOutbox.deleteMany({});
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk: Buffer) => (body += chunk.toString()));
      req.on('end', () => {
        captured.push({ headers: req.headers, body });
        res.statusCode = responseCode;
        res.end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    await prisma.$disconnect();
  });

  async function enqueue(
    tenantId: string,
    url: string,
    overrides: Partial<Prisma.WebhookOutboxUncheckedCreateInput> = {},
  ): Promise<string> {
    const endpoint = await prisma.webhookEndpoint.create({
      data: { tenantId, url, events: [] },
    });
    const row = await prisma.webhookOutbox.create({
      data: {
        tenantId,
        endpointId: endpoint.id,
        url,
        eventType: 'request.approved',
        payload: {
          event: 'request.approved',
          occurredAt: new Date().toISOString(),
          data: { request: { id: 'r-1' } },
        },
        ...overrides,
      },
    });
    return row.id;
  }

  it('delivers a due row with a verifiable HMAC signature', async () => {
    const { tenantId, webhookSecret } = await seedTenant(prisma);
    responseCode = 200;
    const rowId = await enqueue(tenantId, `${baseUrl}/hook`);

    const stats = await deliverDueWebhooks(prisma);
    expect(stats.delivered).toBeGreaterThanOrEqual(1);

    const row = await prisma.webhookOutbox.findUniqueOrThrow({ where: { id: rowId } });
    expect(row.status).toBe('delivered');
    expect(row.attempts).toBe(1);
    expect(row.deliveredAt).not.toBeNull();
    expect(row.lastStatusCode).toBe(200);
    expect(row.lockedAt).toBeNull();

    const hit = captured.find((req) => req.headers['x-approvex-delivery-id'] === rowId);
    expect(hit).toBeDefined();
    expect(hit?.headers['x-approvex-event']).toBe('request.approved');
    // the customer-side verification contract
    expect(
      verifyWebhookSignature(
        webhookSecret,
        hit?.body ?? '',
        String(hit?.headers['x-approvex-signature']),
      ),
    ).toBe(true);
    // tampered body fails
    expect(
      verifyWebhookSignature(
        webhookSecret,
        (hit?.body ?? '').replace('r-1', 'r-2'),
        String(hit?.headers['x-approvex-signature']),
      ),
    ).toBe(false);

    const body = JSON.parse(hit?.body ?? '{}') as Record<string, unknown>;
    expect(body.deliveryId).toBe(rowId);
    expect(body.event).toBe('request.approved');
    expect(body.attempt).toBe(1);
  });

  it('schedules a retry per the backoff schedule on a 5xx', async () => {
    const { tenantId } = await seedTenant(prisma);
    responseCode = 500;
    const rowId = await enqueue(tenantId, `${baseUrl}/hook`);

    const before = Date.now();
    const stats = await deliverDueWebhooks(prisma);
    expect(stats.retried).toBeGreaterThanOrEqual(1);

    const row = await prisma.webhookOutbox.findUniqueOrThrow({ where: { id: rowId } });
    expect(row.status).toBe('pending');
    expect(row.attempts).toBe(1);
    expect(row.lastStatusCode).toBe(500);
    expect(row.lastError).toBe('HTTP 500');
    // first retry ≈ +1 minute
    const delta = row.nextAttemptAt.getTime() - before;
    expect(delta).toBeGreaterThan(50_000);
    expect(delta).toBeLessThan(70_000);

    // not due yet — a second sweep must not touch it
    responseCode = 200;
    await deliverDueWebhooks(prisma);
    const untouched = await prisma.webhookOutbox.findUniqueOrThrow({ where: { id: rowId } });
    expect(untouched.status).toBe('pending');
    expect(untouched.attempts).toBe(1);
  });

  it('handles connection failures as retries (no unhandled throw)', async () => {
    const { tenantId } = await seedTenant(prisma);
    const rowId = await enqueue(tenantId, 'http://127.0.0.1:1/unreachable');

    await deliverDueWebhooks(prisma);
    const row = await prisma.webhookOutbox.findUniqueOrThrow({ where: { id: rowId } });
    expect(row.status).toBe('pending');
    expect(row.attempts).toBe(1);
    expect(row.lastError).toBeTruthy();
    expect(row.lastStatusCode).toBeNull();
  });

  it('dead-letters after the schedule is exhausted and writes an audit event', async () => {
    const { tenantId } = await seedTenant(prisma);
    responseCode = 503;
    // five failures already recorded — the sixth attempt is the last
    const rowId = await enqueue(tenantId, `${baseUrl}/hook`, { attempts: 5 });

    const stats = await deliverDueWebhooks(prisma);
    expect(stats.deadLettered).toBeGreaterThanOrEqual(1);

    const row = await prisma.webhookOutbox.findUniqueOrThrow({ where: { id: rowId } });
    expect(row.status).toBe('dead_letter');
    expect(row.attempts).toBe(6);

    const audit = await prisma.auditEvent.findFirst({
      where: { tenantId, eventType: 'webhook.dead_lettered', entityId: rowId },
    });
    expect(audit).not.toBeNull();

    // dead-lettered rows are never picked up again
    responseCode = 200;
    await deliverDueWebhooks(prisma);
    const still = await prisma.webhookOutbox.findUniqueOrThrow({ where: { id: rowId } });
    expect(still.status).toBe('dead_letter');
  });
});
