import type { INestApplication } from '@nestjs/common';
import { Redis } from 'ioredis';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service';
import type { SignedUpTenant, TestUser } from './utils';
import {
  auth,
  createRole,
  createTestApp,
  createUserWithRoles,
  signupTenant,
  unique,
} from './utils';

/**
 * Phase 6 suite: webhook endpoints + the transactional outbox, API keys with
 * scopes, per-tenant rate limiting, and OIDC env-gating. Delivery itself
 * (HTTP, retries, dead-letter) is covered by the worker's own test suite —
 * here we prove the API writes the right outbox rows in the right
 * transactions.
 */
describe('Phase 6: webhooks, API keys, rate limiting, SSO (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService; // owner connection — used to inspect outbox rows
  let admin: SignedUpTenant;
  let approverRole: string;
  let approver: TestUser;
  let workflowId: string;

  const server = () => app.getHttpServer();

  const publishWorkflow = async (graph: unknown) => {
    const created = await request(server())
      .post('/api/v1/workflows')
      .set(auth(admin.accessToken))
      .send({ name: `wf ${unique('w')}`, graph, rejectionPolicy: 'any_reject_kills' })
      .expect(201);
    await request(server())
      .post(`/api/v1/workflows/${created.body.id}/publish`)
      .set(auth(admin.accessToken))
      .expect(200);
    return created.body.id as string;
  };

  const outboxRows = (tenantId: string, eventType?: string) =>
    prisma.webhookOutbox.findMany({
      where: { tenantId, ...(eventType ? { eventType } : {}) },
      orderBy: { createdAt: 'asc' },
    });

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    admin = await signupTenant(app, 'p6');
    approverRole = await createRole(app, admin.accessToken, 'Approver');
    approver = await createUserWithRoles(app, admin.accessToken, 'p6approver', [approverRole]);
    workflowId = await publishWorkflow({
      nodes: [
        { id: 'start', type: 'start' },
        { id: 'ap', type: 'approval', config: { roleId: approverRole, quorum: 'any' } },
        { id: 'done', type: 'auto_approve' },
      ],
      edges: [
        { from: 'start', to: 'ap' },
        { from: 'ap', to: 'done' },
      ],
    });
  });

  afterAll(async () => {
    await app.close();
  });

  // ------------------------------------------------------ webhook endpoints

  it('manages webhook endpoints (CRUD + validation)', async () => {
    const created = await request(server())
      .post('/api/v1/webhooks')
      .set(auth(admin.accessToken))
      .send({ url: 'https://example.com/hooks', events: ['request.approved'] })
      .expect(201);
    expect(created.body.enabled).toBe(true);

    await request(server())
      .post('/api/v1/webhooks')
      .set(auth(admin.accessToken))
      .send({ url: 'ftp://example.com/nope' })
      .expect(400);
    await request(server())
      .post('/api/v1/webhooks')
      .set(auth(admin.accessToken))
      .send({ url: 'https://example.com/x', events: ['not.an.event'] })
      .expect(400);

    const updated = await request(server())
      .patch(`/api/v1/webhooks/${created.body.id}`)
      .set(auth(admin.accessToken))
      .send({ enabled: false })
      .expect(200);
    expect(updated.body.enabled).toBe(false);

    await request(server())
      .delete(`/api/v1/webhooks/${created.body.id}`)
      .set(auth(admin.accessToken))
      .expect(200);
    const list = await request(server())
      .get('/api/v1/webhooks')
      .set(auth(admin.accessToken))
      .expect(200);
    expect(list.body.some((e: { id: string }) => e.id === created.body.id)).toBe(false);
  });

  it('webhook management requires webhook:manage', async () => {
    const outsider = await createUserWithRoles(app, admin.accessToken, 'nowh', [
      await createRole(app, admin.accessToken, 'NoWebhooks', ['audit:view']),
    ]);
    await request(server()).get('/api/v1/webhooks').set(auth(outsider.token)).expect(403);
    await request(server()).get('/api/v1/webhooks/secret').set(auth(outsider.token)).expect(403);
  });

  it('reveals and rotates the per-tenant signing secret', async () => {
    const first = await request(server())
      .get('/api/v1/webhooks/secret')
      .set(auth(admin.accessToken))
      .expect(200);
    expect(first.body.secret).toMatch(/^[0-9a-f]{64}$/);

    const rotated = await request(server())
      .post('/api/v1/webhooks/secret/rotate')
      .set(auth(admin.accessToken))
      .expect(200);
    expect(rotated.body.secret).not.toBe(first.body.secret);
  });

  // ------------------------------------------------- the transactional outbox

  it('writes outbox rows in the same transaction as the request lifecycle', async () => {
    const tenant = await signupTenant(app, 'p6box');
    const role = await createRole(app, tenant.accessToken, 'Approver');
    const boxApprover = await createUserWithRoles(app, tenant.accessToken, 'boxap', [role]);
    await request(server())
      .post('/api/v1/webhooks')
      .set(auth(tenant.accessToken))
      .send({ url: 'https://example.com/all-events' }) // empty events = everything
      .expect(201);
    const wf = await request(server())
      .post('/api/v1/workflows')
      .set(auth(tenant.accessToken))
      .send({
        name: `wf ${unique('w')}`,
        graph: {
          nodes: [
            { id: 'start', type: 'start' },
            { id: 'ap', type: 'approval', config: { roleId: role, quorum: 'any' } },
            { id: 'done', type: 'auto_approve' },
          ],
          edges: [
            { from: 'start', to: 'ap' },
            { from: 'ap', to: 'done' },
          ],
        },
        rejectionPolicy: 'any_reject_kills',
      })
      .expect(201);
    await request(server())
      .post(`/api/v1/workflows/${wf.body.id}/publish`)
      .set(auth(tenant.accessToken))
      .expect(200);

    const created = await request(server())
      .post('/api/v1/requests')
      .set(auth(tenant.accessToken))
      .send({ workflowId: wf.body.id, payload: { amount: 99 }, title: 'Outbox check' })
      .expect(201);
    const requestId = created.body.requestId as string;

    const afterCreate = await outboxRows(tenant.tenantId, 'request.created');
    expect(afterCreate).toHaveLength(1);
    expect(afterCreate[0]?.status).toBe('pending');
    const createdPayload = afterCreate[0]?.payload as {
      event: string;
      data: { request: { id: string } };
    };
    expect(createdPayload.event).toBe('request.created');
    expect(createdPayload.data.request.id).toBe(requestId);

    const detail = await request(server())
      .get(`/api/v1/requests/${requestId}`)
      .set(auth(tenant.accessToken))
      .expect(200);
    const stepId = detail.body.steps[0].id as string;
    await request(server())
      .post(`/api/v1/steps/${stepId}/approve`)
      .set(auth(boxApprover.token))
      .send({})
      .expect(200);

    const approvedRows = await outboxRows(tenant.tenantId, 'request.approved');
    expect(approvedRows).toHaveLength(1);
    expect(
      (approvedRows[0]?.payload as { data: { request: { status: string } } }).data.request.status,
    ).toBe('approved');

    // a second request, cancelled
    const second = await request(server())
      .post('/api/v1/requests')
      .set(auth(tenant.accessToken))
      .send({ workflowId: wf.body.id, payload: { amount: 1 }, title: 'To cancel' })
      .expect(201);
    await request(server())
      .post(`/api/v1/requests/${second.body.requestId}/cancel`)
      .set(auth(tenant.accessToken))
      .expect(200);
    expect(await outboxRows(tenant.tenantId, 'request.cancelled')).toHaveLength(1);
  });

  it('respects endpoint event subscriptions when fanning out', async () => {
    const tenant = await signupTenant(app, 'p6filter');
    await request(server())
      .post('/api/v1/webhooks')
      .set(auth(tenant.accessToken))
      .send({ url: 'https://example.com/only-approved', events: ['request.approved'] })
      .expect(201);
    const wf = await request(server())
      .post('/api/v1/workflows')
      .set(auth(tenant.accessToken))
      .send({
        name: `wf ${unique('w')}`,
        graph: {
          nodes: [
            { id: 'start', type: 'start' },
            { id: 'done', type: 'auto_approve' },
          ],
          edges: [{ from: 'start', to: 'done' }],
        },
        rejectionPolicy: 'any_reject_kills',
      })
      .expect(201);
    await request(server())
      .post(`/api/v1/workflows/${wf.body.id}/publish`)
      .set(auth(tenant.accessToken))
      .expect(200);
    await request(server())
      .post('/api/v1/requests')
      .set(auth(tenant.accessToken))
      .send({ workflowId: wf.body.id, payload: {}, title: 'Auto' })
      .expect(201);

    // request.created is NOT subscribed; request.approved is
    expect(await outboxRows(tenant.tenantId, 'request.created')).toHaveLength(0);
    expect(await outboxRows(tenant.tenantId, 'request.approved')).toHaveLength(1);
  });

  it('webhook_call nodes enqueue to their inline URL through the outbox', async () => {
    const tenant = await signupTenant(app, 'p6call');
    const wf = await request(server())
      .post('/api/v1/workflows')
      .set(auth(tenant.accessToken))
      .send({
        name: `wf ${unique('w')}`,
        graph: {
          nodes: [
            { id: 'start', type: 'start' },
            { id: 'notify', type: 'webhook_call', config: { url: 'https://erp.example.com/cb' } },
            { id: 'done', type: 'auto_approve' },
          ],
          edges: [
            { from: 'start', to: 'notify' },
            { from: 'notify', to: 'done' },
          ],
        },
        rejectionPolicy: 'any_reject_kills',
      })
      .expect(201);
    await request(server())
      .post(`/api/v1/workflows/${wf.body.id}/publish`)
      .set(auth(tenant.accessToken))
      .expect(200);
    await request(server())
      .post('/api/v1/requests')
      .set(auth(tenant.accessToken))
      .send({ workflowId: wf.body.id, payload: { po: 42 }, title: 'ERP call' })
      .expect(201);

    const rows = await outboxRows(tenant.tenantId, 'workflow.webhook_call');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.url).toBe('https://erp.example.com/cb');
    expect(rows[0]?.endpointId).toBeNull();
  });

  it('ping enqueues a test delivery and the delivery log shows it', async () => {
    const endpoint = await request(server())
      .post('/api/v1/webhooks')
      .set(auth(admin.accessToken))
      .send({ url: 'https://example.com/ping-me' })
      .expect(201);
    await request(server())
      .post(`/api/v1/webhooks/${endpoint.body.id}/ping`)
      .set(auth(admin.accessToken))
      .expect(200);

    const log = await request(server())
      .get(`/api/v1/webhooks/${endpoint.body.id}/deliveries`)
      .set(auth(admin.accessToken))
      .expect(200);
    expect(log.body.total).toBe(1);
    expect(log.body.items[0].eventType).toBe('ping');
    expect(log.body.items[0].status).toBe('pending');
  });

  // ---------------------------------------------------------------- API keys

  it('creates an API key (plaintext once) and authenticates with it', async () => {
    const created = await request(server())
      .post('/api/v1/api-keys')
      .set(auth(admin.accessToken))
      .send({ name: `erp ${unique('k')}`, scopes: ['evaluate', 'request:read'] })
      .expect(201);
    expect(created.body.key).toMatch(/^ax_[0-9a-f]{48}$/);
    expect(created.body.prefix).toBe(created.body.key.slice(0, 10));

    // the list never exposes the key again
    const list = await request(server())
      .get('/api/v1/api-keys')
      .set(auth(admin.accessToken))
      .expect(200);
    const row = list.body.find((k: { id: string }) => k.id === created.body.id);
    expect(row.key).toBeUndefined();
    expect(row.prefix).toBe(created.body.prefix);

    // scoped access works
    const evalRes = await request(server())
      .post('/api/v1/evaluate')
      .set(auth(created.body.key))
      .send({ context: 'NOPE', data: { amount: 1 }, mode: 'dry_run' })
      .expect(200);
    expect(evalRes.body.matched).toBe(false);
    await request(server()).get('/api/v1/requests').set(auth(created.body.key)).expect(200);

    // missing scope → 403; human-only endpoint → 403
    await request(server())
      .post('/api/v1/requests')
      .set(auth(created.body.key))
      .send({ workflowId, payload: {} })
      .expect(403);
    await request(server()).get('/api/v1/rules').set(auth(created.body.key)).expect(403);

    // revocation is immediate
    await request(server())
      .post(`/api/v1/api-keys/${created.body.id}/revoke`)
      .set(auth(admin.accessToken))
      .expect(200);
    await request(server())
      .post('/api/v1/evaluate')
      .set(auth(created.body.key))
      .send({ context: 'NOPE', data: {}, mode: 'dry_run' })
      .expect(401);
  });

  it('API-key-created requests carry the key as creator; humans still approve', async () => {
    const created = await request(server())
      .post('/api/v1/api-keys')
      .set(auth(admin.accessToken))
      .send({ name: `erp-writer ${unique('k')}`, scopes: ['request:create', 'request:read'] })
      .expect(201);

    const made = await request(server())
      .post('/api/v1/requests')
      .set(auth(created.body.key))
      .send({ workflowId, payload: { amount: 500 }, title: 'From ERP' })
      .expect(201);
    expect(made.body.status).toBe('pending');

    const detail = await request(server())
      .get(`/api/v1/requests/${made.body.requestId}`)
      .set(auth(admin.accessToken))
      .expect(200);
    expect(detail.body.createdBy.name).toContain('(API key)');

    const stepId = detail.body.steps[0].id as string;
    await request(server())
      .post(`/api/v1/steps/${stepId}/approve`)
      .set(auth(approver.token))
      .send({})
      .expect(200);
    const after = await request(server())
      .get(`/api/v1/requests/${made.body.requestId}`)
      .set(auth(admin.accessToken))
      .expect(200);
    expect(after.body.status).toBe('approved');
  });

  it('bad and foreign API keys are rejected', async () => {
    await request(server())
      .post('/api/v1/evaluate')
      .set(auth('ax_deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef'))
      .send({ context: 'X', data: {}, mode: 'dry_run' })
      .expect(401);

    // key management needs apikey:manage
    const outsider = await createUserWithRoles(app, admin.accessToken, 'nokeys', [
      await createRole(app, admin.accessToken, 'NoKeys', ['audit:view']),
    ]);
    await request(server()).get('/api/v1/api-keys').set(auth(outsider.token)).expect(403);
  });

  // ------------------------------------------------------------ rate limiting

  it('throttles a tenant that bursts past RATE_LIMIT_RPM (needs Redis)', async () => {
    const probe = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
      lazyConnect: true,
      enableOfflineQueue: false,
    });
    probe.on('error', () => undefined);
    try {
      await probe.connect();
      await probe.ping();
    } catch {
      console.warn('[phase6 spec] Redis unavailable — skipping rate-limit assertions (fail-open)');
      probe.disconnect();
      return;
    }
    probe.disconnect();

    const tenant = await signupTenant(app, 'p6rate');
    process.env.RATE_LIMIT_RPM = '5';
    try {
      const results: number[] = [];
      for (let i = 0; i < 8; i += 1) {
        const res = await request(server())
          .post('/api/v1/evaluate')
          .set(auth(tenant.accessToken))
          .send({ context: 'RL', data: { n: i }, mode: 'dry_run' });
        results.push(res.status);
        if (res.status === 429) {
          expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
        }
      }
      expect(results.filter((status) => status === 200).length).toBe(5);
      expect(results.filter((status) => status === 429).length).toBe(3);

      // other tenants are unaffected (per-tenant window)
      await request(server())
        .post('/api/v1/evaluate')
        .set(auth(admin.accessToken))
        .send({ context: 'RL', data: {}, mode: 'dry_run' })
        .expect(200);
    } finally {
      delete process.env.RATE_LIMIT_RPM;
    }
  });

  // ------------------------------------------------------------------- OIDC

  it('OIDC is env-gated: no providers unless configured', async () => {
    delete process.env.OIDC_GOOGLE_CLIENT_ID;
    delete process.env.OIDC_GOOGLE_CLIENT_SECRET;
    const empty = await request(server()).get('/api/v1/auth/oidc/providers').expect(200);
    expect(empty.body.providers).toEqual([]);
    await request(server()).get('/api/v1/auth/oidc/google/start').expect(404);

    process.env.OIDC_GOOGLE_CLIENT_ID = 'test-client-id.apps.googleusercontent.com';
    process.env.OIDC_GOOGLE_CLIENT_SECRET = 'test-secret';
    try {
      const listed = await request(server()).get('/api/v1/auth/oidc/providers').expect(200);
      expect(listed.body.providers).toEqual([{ id: 'google', label: 'Google' }]);

      const start = await request(server()).get('/api/v1/auth/oidc/google/start').expect(302);
      const location = new URL(start.headers.location ?? '');
      expect(location.origin + location.pathname).toBe(
        'https://accounts.google.com/o/oauth2/v2/auth',
      );
      expect(location.searchParams.get('client_id')).toBe(
        'test-client-id.apps.googleusercontent.com',
      );
      expect(location.searchParams.get('state')).toBeTruthy();
      expect(location.searchParams.get('nonce')).toBeTruthy();
      expect(location.searchParams.get('redirect_uri')).toContain(
        '/api/v1/auth/oidc/google/callback',
      );

      // forged state → lands on the SPA with an error fragment, never a session
      const cb = await request(server())
        .get('/api/v1/auth/oidc/google/callback?code=fake&state=forged')
        .expect(302);
      expect(cb.headers.location).toContain('/auth/callback#error=');
    } finally {
      delete process.env.OIDC_GOOGLE_CLIENT_ID;
      delete process.env.OIDC_GOOGLE_CLIENT_SECRET;
    }
  });
});
