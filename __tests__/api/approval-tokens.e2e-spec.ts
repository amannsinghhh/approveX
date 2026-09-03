import { createHash, randomBytes } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../../apps/api/src/prisma/prisma.service';
import { RedisService } from '../../apps/api/src/redis/redis.service';
import { ApprovalTokensService } from '../../apps/api/src/approval-tokens/approval-tokens.service';
import type { SignedUpTenant, TestUser } from './utils';
import {
  auth,
  createRole,
  createTestApp,
  createUserWithRoles,
  signupTenant,
  unique,
} from './utils';

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

/**
 * Workstream A / Checkpoint 1 (spec §no-login approvals): the public, pre-auth
 * landing surface for email/WhatsApp approval links. Drives the real HTTP
 * routes end-to-end — mint a token with the service, then act on it exactly as
 * an approver clicking a link would: no JWT, raw token in the URL.
 *
 * Every branch of the `state` discriminator is exercised (valid / not_found /
 * expired / consumed / already_handled / over_ceiling / invalid_action), plus
 * the two properties that make the feature safe to ship: single-use under
 * concurrency, and the raw token never touching the database.
 */
describe('No-login approval tokens (e2e)', () => {
  let app: INestApplication;
  let admin: SignedUpTenant;
  let mgrRole: string;
  let mgr1: TestUser;
  let tokens: ApprovalTokensService;

  const server = () => app.getHttpServer();

  // Single approval tier so each request has exactly one pending step to reason about.
  const singleTierGraph = () => ({
    nodes: [
      { id: 'start', type: 'start' },
      { id: 'mgr', type: 'approval', config: { roleId: mgrRole, quorum: 'any', slaHours: 48 } },
      { id: 'done', type: 'auto_approve' },
    ],
    edges: [
      { from: 'start', to: 'mgr' },
      { from: 'mgr', to: 'done' },
    ],
  });

  const publishWorkflow = async () => {
    const created = await request(server())
      .post('/api/v1/workflows')
      .set(auth(admin.accessToken))
      .send({ name: `wf ${unique('w')}`, graph: singleTierGraph(), rejectionPolicy: 'any_reject_kills' })
      .expect(201);
    await request(server())
      .post(`/api/v1/workflows/${created.body.id}/publish`)
      .set(auth(admin.accessToken))
      .expect(200);
    return created.body.id as string;
  };

  const publishBoundRule = async (workflowId: string) => {
    const context = `CTX_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
    const rule = await request(server())
      .post('/api/v1/rules')
      .set(auth(admin.accessToken))
      .send({
        name: `rule ${unique('r')}`,
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
    return context;
  };

  /** Evaluate → open request → return the ids of its single pending step. */
  const freshStep = async (amount = 1000): Promise<{ requestId: string; stepId: string }> => {
    const workflowId = await publishWorkflow();
    const context = await publishBoundRule(workflowId);
    const executed = await request(server())
      .post('/api/v1/evaluate')
      .set(auth(admin.accessToken))
      .send({ context, data: { amount }, mode: 'execute' })
      .expect(200);
    const requestId = executed.body.requestId as string;
    const detail = await request(server())
      .get(`/api/v1/requests/${requestId}`)
      .set(auth(admin.accessToken))
      .expect(200);
    const step = detail.body.steps.find(
      (s: { status: string; nodeId: string }) => s.status === 'pending' && s.nodeId === 'mgr',
    );
    return { requestId, stepId: step.id as string };
  };

  const mint = (
    stepId: string,
    opts: { allowedActions?: ('approve' | 'reject')[]; expiresAt?: Date } = {},
  ) => tokens.issue({ tenantId: admin.tenantId, stepId, userId: mgr1.userId, channel: 'email', ...opts });

  const preview = (token: string) => request(server()).get(`/api/v1/public/approvals/${token}`);
  const consume = (token: string, body: object) =>
    request(server()).post(`/api/v1/public/approvals/${token}`).send(body);

  const requestDetail = async (requestId: string) =>
    (
      await request(server())
        .get(`/api/v1/requests/${requestId}`)
        .set(auth(admin.accessToken))
        .expect(200)
    ).body;

  beforeAll(async () => {
    app = await createTestApp();
    // Keep the per-IP limiter out of the way — the whole suite hits the public
    // routes from one address; only the dedicated test tunes the per-token bucket.
    process.env.APPROVAL_TOKEN_IP_MAX_ATTEMPTS = '100000';
    admin = await signupTenant(app, 'nlt');
    mgrRole = await createRole(app, admin.accessToken, 'Manager');
    mgr1 = await createUserWithRoles(app, admin.accessToken, 'mgr1', [mgrRole]);
    tokens = app.get(ApprovalTokensService);
  }, 30000);

  afterAll(async () => {
    delete process.env.APPROVAL_TOKEN_IP_MAX_ATTEMPTS;
    delete process.env.APPROVAL_TOKEN_MAX_ATTEMPTS;
    await app.close();
  });

  it('preview renders a valid, actionable link for the bound approver', async () => {
    const { requestId, stepId } = await freshStep(1000);
    const { token, expiresAt } = await mint(stepId);

    const res = await preview(token).expect(200);
    expect(res.body.state).toBe('valid');
    expect(res.body.requestId).toBe(requestId);
    expect(res.body.stepId).toBe(stepId);
    expect(res.body.approverName).toBe('mgr1');
    expect(res.body.allowedActions).toEqual(['approve', 'reject']);
    expect(res.body.amount).toBe(1000);
    expect(res.body.ceiling).toBe(500000);
    expect(new Date(res.body.expiresAt).getTime()).toBe(expiresAt.getTime());
  });

  it('preview is read-only — it never consumes the token', async () => {
    const { stepId } = await freshStep();
    const { token } = await mint(stepId);

    expect((await preview(token).expect(200)).body.state).toBe('valid');
    expect((await preview(token).expect(200)).body.state).toBe('valid');
    // The link is still spendable afterwards.
    expect((await consume(token, { action: 'approve' }).expect(200)).body.state).toBe('acted');
  });

  it('approve via token advances the step to approved', async () => {
    const { requestId, stepId } = await freshStep();
    const { token } = await mint(stepId);

    const res = await consume(token, { action: 'approve' }).expect(200);
    expect(res.body.state).toBe('acted');
    expect(res.body.action).toBe('approve');
    expect(res.body.requestId).toBe(requestId);

    const detail = await requestDetail(requestId);
    const step = detail.steps.find((s: { nodeId: string }) => s.nodeId === 'mgr');
    expect(step.status).toBe('approved');
  });

  it('reject via token (with comment) kills the request', async () => {
    const { requestId, stepId } = await freshStep();
    const { token } = await mint(stepId);

    const res = await consume(token, { action: 'reject', comment: 'Out of policy' }).expect(200);
    expect(res.body.state).toBe('acted');
    expect(res.body.action).toBe('reject');

    const detail = await requestDetail(requestId);
    const step = detail.steps.find((s: { nodeId: string }) => s.nodeId === 'mgr');
    expect(step.status).toBe('rejected');
  });

  it('reject without a comment is refused, leaving the token unspent', async () => {
    const { stepId } = await freshStep();
    const { token } = await mint(stepId);

    const refused = await consume(token, { action: 'reject' }).expect(200);
    expect(refused.body.state).toBe('invalid_action');
    expect(refused.body.reason).toBe('comment_required');

    // Not consumed — a follow-up with a comment still works.
    const ok = await consume(token, { action: 'reject', comment: 'Now with reason' }).expect(200);
    expect(ok.body.state).toBe('acted');
  });

  it('rejects an action the link does not permit', async () => {
    const { stepId } = await freshStep();
    const { token } = await mint(stepId, { allowedActions: ['approve'] });

    const res = await consume(token, { action: 'reject', comment: 'nope' }).expect(200);
    expect(res.body.state).toBe('invalid_action');
    expect(res.body.reason).toBe('not_allowed');
  });

  it('is single-use — a second consume reports the prior action', async () => {
    const { stepId } = await freshStep();
    const { token } = await mint(stepId);

    expect((await consume(token, { action: 'approve' }).expect(200)).body.state).toBe('acted');

    const again = await consume(token, { action: 'approve' }).expect(200);
    expect(again.body.state).toBe('consumed');
    expect(again.body.action).toBe('approve');
    expect(again.body.consumedAt).toBeTruthy();
  });

  it('concurrent taps: exactly one acts, the loser sees a friendly state', async () => {
    const { stepId } = await freshStep();
    const { token } = await mint(stepId);

    const results = await Promise.all([
      consume(token, { action: 'approve' }),
      consume(token, { action: 'approve' }),
    ]);
    const states = results.map((r) => r.body.state);
    expect(states.filter((s) => s === 'acted')).toHaveLength(1);
    const loser = states.find((s) => s !== 'acted');
    expect(['consumed', 'already_handled']).toContain(loser);
    // Neither tap 500s.
    results.forEach((r) => expect(r.status).toBe(200));
  });

  it('reports already_handled when the step was decided in-app first', async () => {
    const { stepId } = await freshStep();
    const { token } = await mint(stepId);

    // mgr1 approves through the normal authenticated surface.
    await request(server())
      .post(`/api/v1/steps/${stepId}/approve`)
      .set(auth(mgr1.token))
      .send({})
      .expect(200);

    const view = await preview(token).expect(200);
    expect(view.body.state).toBe('already_handled');
    expect(view.body.handledBy).toBe('mgr1');

    const outcome = await consume(token, { action: 'approve' }).expect(200);
    expect(outcome.body.state).toBe('already_handled');
  });

  it('reports over_ceiling for a request above the no-login limit', async () => {
    const { stepId } = await freshStep(600000);
    const { token } = await mint(stepId);

    const view = await preview(token).expect(200);
    expect(view.body.state).toBe('over_ceiling');
    expect(view.body.amount).toBe(600000);
    expect(view.body.ceiling).toBe(500000);

    const outcome = await consume(token, { action: 'approve' }).expect(200);
    expect(outcome.body.state).toBe('over_ceiling');
  });

  it('reports expired for a link past its lifetime', async () => {
    const { stepId } = await freshStep();
    const { token } = await mint(stepId, { expiresAt: new Date(Date.now() - 1000) });

    expect((await preview(token).expect(200)).body.state).toBe('expired');
    expect((await consume(token, { action: 'approve' }).expect(200)).body.state).toBe('expired');
  });

  it('reports not_found for an unknown token', async () => {
    const bogus = randomBytes(32).toString('hex');
    expect((await preview(bogus).expect(200)).body.state).toBe('not_found');
    expect((await consume(bogus, { action: 'approve' }).expect(200)).body.state).toBe('not_found');
  });

  it('persists only the token hash — the raw token never hits the database', async () => {
    const { stepId } = await freshStep();
    const { token, id } = await mint(stepId);

    const prisma = app.get(PrismaService);
    const row = await prisma.approvalToken.findUnique({ where: { id } });
    expect(row).toBeTruthy();
    expect(row!.tokenHash).toBe(sha256(token));
    expect(row!.tokenHash).not.toBe(token);
    // No column (hash, ids, ip, ua) smuggles the raw secret.
    expect(JSON.stringify(row)).not.toContain(token);
  });

  it('rate-limits a burst against a single token (needs Redis)', async () => {
    const redis = app.get(RedisService);
    let redisUp = true;
    try {
      await redis.client.incr(`atl:probe:${Date.now()}`);
    } catch {
      redisUp = false;
    }
    if (!redisUp) return; // Limiter fails open without Redis — nothing to assert.

    process.env.APPROVAL_TOKEN_MAX_ATTEMPTS = '2';
    try {
      const { stepId } = await freshStep();
      const { token } = await mint(stepId);
      const statuses: number[] = [];
      for (let i = 0; i < 5; i++) statuses.push((await preview(token)).status);
      expect(statuses.filter((s) => s === 429).length).toBeGreaterThan(0);
      // The first hits within the window still succeed.
      expect(statuses[0]).toBe(200);
    } finally {
      delete process.env.APPROVAL_TOKEN_MAX_ATTEMPTS;
    }
  });
});
