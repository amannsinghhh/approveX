import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SignedUpTenant } from './utils';
import { auth, createRole, createTestApp, createUserWithRoles, signupTenant, unique } from './utils';

/**
 * M5-CP2 (B.3 #6): velocity aggregates over real request history — the
 * provider computes COUNT/SUM per group from the requests table, caches per
 * (tenant, key) in Redis with a short TTL, and excludes cancelled requests
 * (test scenario 17). Fiscal windows are covered at the unit level
 * (scenario 22); here we exercise the full HTTP → provider → Postgres path.
 */
describe('Aggregate provider (e2e)', () => {
  let app: INestApplication;
  let admin: SignedUpTenant;
  let seedContext: string;
  let pendingSeedContext: string;

  const server = () => app.getHttpServer();

  /** start → auto_approve, so seeded executes need no human approver. */
  const autoGraph = () => ({
    nodes: [
      { id: 'start', type: 'start' },
      { id: 'done', type: 'auto_approve' },
    ],
    edges: [{ from: 'start', to: 'done' }],
  });

  const publishRule = async (body: Record<string, unknown>): Promise<string> => {
    const created = await request(server())
      .post('/api/v1/rules')
      .set(auth(admin.accessToken))
      .send(body)
      .expect(201);
    await request(server())
      .post(`/api/v1/rules/${created.body.id}/publish`)
      .set(auth(admin.accessToken))
      .expect(200);
    return created.body.id as string;
  };

  /**
   * Executes a seed rule, creating one request with `data` as payload —
   * auto-approved by default, or left pending (cancellable) on demand.
   */
  const seed = async (data: Record<string, unknown>, opts?: { pending: boolean }): Promise<string> => {
    const res = await request(server())
      .post('/api/v1/evaluate')
      .set(auth(admin.accessToken))
      .send({ context: opts?.pending ? pendingSeedContext : seedContext, data, mode: 'execute' })
      .expect(200);
    expect(res.body.requestId).toBeTruthy();
    return res.body.requestId as string;
  };

  const dryRun = async (context: string, data: Record<string, unknown>) => {
    const res = await request(server())
      .post('/api/v1/evaluate')
      .set(auth(admin.accessToken))
      .send({ context, data, mode: 'dry_run' })
      .expect(200);
    return res.body;
  };

  /** The aggregate leaf's observed value, from the winner's structured trace. */
  const aggregateActual = (body: { evaluationTrace: { nodes: { actual?: unknown }[] } }) =>
    body.evaluationTrace.nodes[0]?.actual;

  const publishWorkflow = async (graph: unknown): Promise<string> => {
    const created = await request(server())
      .post('/api/v1/workflows')
      .set(auth(admin.accessToken))
      .send({ name: `wf ${unique('w')}`, graph })
      .expect(201);
    await request(server())
      .post(`/api/v1/workflows/${created.body.id}/publish`)
      .set(auth(admin.accessToken))
      .expect(200);
    return created.body.id as string;
  };

  const publishBoundSeedRule = async (context: string, workflowId: string): Promise<void> => {
    const rule = await request(server())
      .post('/api/v1/rules')
      .set(auth(admin.accessToken))
      .send({
        name: `seed ${unique('r')}`,
        context,
        conditionAst: { field: 'amount', operator: '>', value: 0 },
      })
      .expect(201);
    await request(server())
      .put(`/api/v1/rules/${rule.body.id}/binding`)
      .set(auth(admin.accessToken))
      .send({ workflowId })
      .expect(200);
    await request(server())
      .post(`/api/v1/rules/${rule.body.id}/publish`)
      .set(auth(admin.accessToken))
      .expect(200);
  };

  beforeAll(async () => {
    app = await createTestApp();
    admin = await signupTenant(app, 'agg');
    seedContext = `CTX_AGG_SEED_${Date.now()}`;
    pendingSeedContext = `CTX_AGG_PENDING_${Date.now()}`;

    await publishBoundSeedRule(seedContext, await publishWorkflow(autoGraph()));

    // Pending path: a one-approver workflow that nobody approves, so the
    // request stays cancellable.
    const approverRole = await createRole(app, admin.accessToken, 'agg approver');
    await createUserWithRoles(app, admin.accessToken, 'agg-approver', [approverRole]);
    const pendingGraph = {
      nodes: [
        { id: 'start', type: 'start' },
        { id: 'appr', type: 'approval', config: { roleId: approverRole, quorum: 'any' } },
        { id: 'done', type: 'auto_approve' },
      ],
      edges: [
        { from: 'start', to: 'appr' },
        { from: 'appr', to: 'done' },
      ],
    };
    await publishBoundSeedRule(pendingSeedContext, await publishWorkflow(pendingGraph));
  });

  afterAll(async () => {
    await app.close();
  });

  it('counts request velocity per group over a rolling window (scenario 17)', async () => {
    const context = `CTX_AGG_COUNT_${Date.now()}`;
    await seed({ amount: 10, vendor_id: 'V1' });
    await seed({ amount: 20, vendor_id: 'V1' });
    await seed({ amount: 30, vendor_id: 'V1' });

    await publishRule({
      name: `velocity ${unique('r')}`,
      context,
      conditionAst: {
        field: 'vendor_id',
        operator: 'AGGREGATE_COUNT_WITHIN',
        value: { window: { kind: 'rolling', days: 30 }, compare: '>', threshold: 2 },
      },
    });

    const hit = await dryRun(context, { vendor_id: 'V1' });
    expect(hit.matched).toBe(true);
    expect(aggregateActual(hit)).toBe(3);

    // A group with no history counts 0 — below threshold, no match.
    const miss = await dryRun(context, { vendor_id: 'V-none' });
    expect(miss.matched).toBe(false);
  });

  it('serves cached values within the short TTL instead of re-querying history', async () => {
    const context = `CTX_AGG_CACHE_${Date.now()}`;
    await seed({ amount: 5, vendor_id: 'V-cache' });

    await publishRule({
      name: `cache ${unique('r')}`,
      context,
      conditionAst: {
        field: 'vendor_id',
        operator: 'AGGREGATE_COUNT_WITHIN',
        value: { window: { kind: 'rolling', days: 30 }, compare: '>', threshold: 0 },
      },
    });

    const first = await dryRun(context, { vendor_id: 'V-cache' });
    expect(aggregateActual(first)).toBe(1);

    // New history within the TTL is invisible: staleness is bounded, not zero.
    await seed({ amount: 6, vendor_id: 'V-cache' });
    const second = await dryRun(context, { vendor_id: 'V-cache' });
    expect(aggregateActual(second)).toBe(1);
  });

  it('sums a payload field per group and excludes cancelled requests', async () => {
    const context = `CTX_AGG_SUM_${Date.now()}`;
    await seed({ amount: 100_000, requester_id: 'R1' });
    await seed({ amount: 200_000, requester_id: 'R1' });
    const cancelId = await seed({ amount: 400_000, requester_id: 'R1' }, { pending: true });
    await request(server())
      .post(`/api/v1/requests/${cancelId}/cancel`)
      .set(auth(admin.accessToken))
      .expect(200);

    await publishRule({
      name: `ytd spend ${unique('r')}`,
      context,
      conditionAst: {
        field: 'requester_id',
        operator: 'AGGREGATE_SUM_WITHIN',
        value: {
          window: { kind: 'rolling', days: 30 },
          compare: '>=',
          threshold: 250_000,
          sumField: 'amount',
        },
      },
    });

    // 100k + 200k; the cancelled 400k must not count (scenario 17).
    const body = await dryRun(context, { requester_id: 'R1' });
    expect(body.matched).toBe(true);
    expect(aggregateActual(body)).toBe(300_000);
  });
});
