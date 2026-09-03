import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../../apps/api/src/prisma/prisma.service';
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
 * Phase 4 scenario suite (spec §10): the full evaluate → approve lifecycle,
 * maker-checker, quorums, parallel branches, rejection policies, delegation,
 * idempotency, concurrency, and version pinning.
 */
describe('Approvals engine (e2e)', () => {
  let app: INestApplication;
  let admin: SignedUpTenant;
  let mgrRole: string;
  let finRole: string;
  let cfoRole: string;
  let mgr1: TestUser;
  let mgr2: TestUser;
  let fin1: TestUser;
  let cfo1: TestUser;

  const server = () => app.getHttpServer();

  const threeTierGraph = () => ({
    nodes: [
      { id: 'start', type: 'start' },
      { id: 'mgr', type: 'approval', config: { roleId: mgrRole, quorum: 'any', slaHours: 48 } },
      { id: 'fin', type: 'approval', config: { roleId: finRole, quorum: 'any' } },
      { id: 'cfo', type: 'approval', config: { roleId: cfoRole, quorum: 'any' } },
      { id: 'done', type: 'auto_approve' },
    ],
    edges: [
      { from: 'start', to: 'mgr' },
      { from: 'mgr', to: 'fin' },
      { from: 'fin', to: 'cfo' },
      { from: 'cfo', to: 'done' },
    ],
  });

  /** Publishes a workflow and returns its id. */
  const publishWorkflow = async (graph: unknown, rejectionPolicy = 'any_reject_kills') => {
    const created = await request(server())
      .post('/api/v1/workflows')
      .set(auth(admin.accessToken))
      .send({ name: `wf ${unique('w')}`, graph, rejectionPolicy })
      .expect(201);
    await request(server())
      .post(`/api/v1/workflows/${created.body.id}/publish`)
      .set(auth(admin.accessToken))
      .expect(200);
    return created.body.id as string;
  };

  /** Publishes a rule in a fresh context, binds it, returns the context. */
  const publishBoundRule = async (workflowId: string, threshold = 0) => {
    const context = `CTX_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
    const rule = await request(server())
      .post('/api/v1/rules')
      .set(auth(admin.accessToken))
      .send({
        name: `rule ${unique('r')}`,
        context,
        conditionAst: { field: 'amount', operator: '>', value: threshold },
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

  const execute = async (context: string, data: Record<string, unknown>, key?: string) => {
    let req = request(server()).post('/api/v1/evaluate').set(auth(admin.accessToken));
    if (key) req = req.set('Idempotency-Key', key);
    const res = await req.send({ context, data, mode: 'execute' }).expect(200);
    return res.body;
  };

  const act = (token: string, stepId: string, action: string, body: object = {}) =>
    request(server()).post(`/api/v1/steps/${stepId}/${action}`).set(auth(token)).send(body);

  const pendingStep = async (requestId: string, nodeId?: string) => {
    const res = await request(server())
      .get(`/api/v1/requests/${requestId}`)
      .set(auth(admin.accessToken))
      .expect(200);
    const steps = res.body.steps.filter(
      (step: { status: string; nodeId: string }) =>
        step.status === 'pending' && (!nodeId || step.nodeId === nodeId),
    );
    return { detail: res.body, step: steps[0] };
  };

  beforeAll(async () => {
    app = await createTestApp();
    admin = await signupTenant(app, 'eng');
    mgrRole = await createRole(app, admin.accessToken, 'Manager');
    finRole = await createRole(app, admin.accessToken, 'Finance Head');
    cfoRole = await createRole(app, admin.accessToken, 'CFO');
    [mgr1, mgr2, fin1, cfo1] = await Promise.all([
      createUserWithRoles(app, admin.accessToken, 'mgr1', [mgrRole]),
      createUserWithRoles(app, admin.accessToken, 'mgr2', [mgrRole]),
      createUserWithRoles(app, admin.accessToken, 'fin1', [finRole]),
      createUserWithRoles(app, admin.accessToken, 'cfo1', [cfoRole]),
    ]);
  }, 30000);

  afterAll(async () => {
    await app.close();
  });

  it('spec e2e: evaluate → 3-tier approval → approved', async () => {
    const workflowId = await publishWorkflow(threeTierGraph());
    const context = await publishBoundRule(workflowId);

    const executed = await execute(context, { amount: 840000 });
    expect(executed.matched).toBe(true);
    expect(executed.requestId).toBeTruthy();
    expect(executed.status).toBe('pending');
    expect(executed.pendingApprovers).toHaveLength(1);
    expect(executed.pendingApprovers[0].roleName).toContain('Manager');
    expect(executed.pendingApprovers[0].dueAt).toBeTruthy(); // 48h SLA

    // Tier 1: manager
    let { step } = await pendingStep(executed.requestId, 'mgr');
    await act(mgr1.token, step.id, 'approve', { comment: 'Within budget' }).expect(200);

    // Tier 2: finance
    ({ step } = await pendingStep(executed.requestId, 'fin'));
    expect(step).toBeTruthy();
    await act(fin1.token, step.id, 'approve').expect(200);

    // Tier 3: CFO
    ({ step } = await pendingStep(executed.requestId, 'cfo'));
    const final = await act(cfo1.token, step.id, 'approve').expect(200);
    expect(final.body.status).toBe('approved');
    expect(final.body.completedAt).toBeTruthy();

    // Timeline: three approved steps with their actions
    const detail = await request(server())
      .get(`/api/v1/requests/${executed.requestId}`)
      .set(auth(admin.accessToken))
      .expect(200);
    expect(detail.body.steps).toHaveLength(3);
    expect(detail.body.steps.every((s: { status: string }) => s.status === 'approved')).toBe(true);
    expect(detail.body.steps[0].actions[0].comment).toBe('Within budget');
  });

  it('dry_run never creates requests', async () => {
    const workflowId = await publishWorkflow(threeTierGraph());
    const context = await publishBoundRule(workflowId);
    const prisma = app.get(PrismaService);
    const before = await prisma.request.count({ where: { tenantId: admin.tenantId } });

    const res = await request(server())
      .post('/api/v1/evaluate')
      .set(auth(admin.accessToken))
      .send({ context, data: { amount: 100 }, mode: 'dry_run' })
      .expect(200);
    expect(res.body.wouldStartWorkflow.workflowId).toBe(workflowId);

    const after = await prisma.request.count({ where: { tenantId: admin.tenantId } });
    expect(after).toBe(before);
  });

  it('idempotency: same key returns the original response, one request row', async () => {
    const workflowId = await publishWorkflow(threeTierGraph());
    const context = await publishBoundRule(workflowId);
    const key = unique('idem');

    const first = await execute(context, { amount: 500 }, key);
    const second = await execute(context, { amount: 500 }, key);
    expect(second.requestId).toBe(first.requestId);

    const prisma = app.get(PrismaService);
    const count = await prisma.request.count({
      where: { tenantId: admin.tenantId, idempotencyKey: key },
    });
    expect(count).toBe(1);
  });

  it('maker-checker: the requester is excluded even when they hold the approver role', async () => {
    // Give the admin (requester) the Manager role IN ADDITION to Admin
    const me = await request(server()).get('/api/v1/me').set(auth(admin.accessToken)).expect(200);
    const currentRoleIds = me.body.roles.map((role: { id: string }) => role.id);
    await request(server())
      .patch(`/api/v1/users/${admin.userId}`)
      .set(auth(admin.accessToken))
      .send({ roleIds: [...new Set([...currentRoleIds, mgrRole])] })
      .expect(200);

    const workflowId = await publishWorkflow(threeTierGraph());
    const context = await publishBoundRule(workflowId);
    const executed = await execute(context, { amount: 99 });

    // Excluded from the eligible list…
    const eligibleIds = executed.pendingApprovers[0].eligibleUsers.map(
      (user: { id: string }) => user.id,
    );
    expect(eligibleIds).not.toContain(admin.userId);
    expect(eligibleIds).toEqual(expect.arrayContaining([mgr1.userId, mgr2.userId]));

    // …and blocked when trying anyway
    const { step } = await pendingStep(executed.requestId, 'mgr');
    const attempt = await act(admin.accessToken, step.id, 'approve');
    expect(attempt.status).toBe(403);
    expect(attempt.body.message).toContain('own request');
  }, 15000);

  it('requester as the ONLY role member blocks instantiation with a clear error', async () => {
    const soloRole = await createRole(app, admin.accessToken, 'Solo');
    // give the role only to the admin — who will be the requester
    const meRes = await request(server()).get('/api/v1/me').set(auth(admin.accessToken));
    const currentRoleIds = meRes.body.roles.map((role: { id: string }) => role.id);
    await request(server())
      .patch(`/api/v1/users/${admin.userId}`)
      .set(auth(admin.accessToken))
      .send({ roleIds: [...currentRoleIds, soloRole] })
      .expect(200);

    const graph = {
      nodes: [
        { id: 'start', type: 'start' },
        { id: 'solo', type: 'approval', config: { roleId: soloRole } },
      ],
      edges: [{ from: 'start', to: 'solo' }],
    };
    const workflowId = await publishWorkflow(graph);
    const context = await publishBoundRule(workflowId);

    const res = await request(server())
      .post('/api/v1/evaluate')
      .set(auth(admin.accessToken))
      .send({ context, data: { amount: 5 }, mode: 'execute' })
      .expect(422);
    expect(res.body.message).toContain('no eligible approver');

    const prisma = app.get(PrismaService);
    const count = await prisma.request.count({
      where: { tenantId: admin.tenantId, context },
    });
    expect(count).toBe(0); // blocked BEFORE creating anything
  }, 15000);

  it('empty role with escalation target escalates at instantiation', async () => {
    const emptyRole = await createRole(app, admin.accessToken, 'Empty');
    const graph = {
      nodes: [
        { id: 'start', type: 'start' },
        {
          id: 'step1',
          type: 'approval',
          config: { roleId: emptyRole, escalateToRoleId: mgrRole },
        },
      ],
      edges: [{ from: 'start', to: 'step1' }],
    };
    const workflowId = await publishWorkflow(graph);
    const context = await publishBoundRule(workflowId);

    const executed = await execute(context, { amount: 10 });
    expect(executed.status).toBe('pending');
    expect(executed.pendingApprovers[0].roleId).toBe(mgrRole);

    const { step } = await pendingStep(executed.requestId);
    expect(step.escalatedToRoleId).toBe(mgrRole);
  });

  it('a user cannot approve the same step twice; outsiders get 403', async () => {
    const graph = {
      nodes: [
        { id: 'start', type: 'start' },
        { id: 'mgr', type: 'approval', config: { roleId: mgrRole, quorum: 'all' } },
      ],
      edges: [{ from: 'start', to: 'mgr' }],
    };
    const workflowId = await publishWorkflow(graph);
    const context = await publishBoundRule(workflowId);
    const executed = await execute(context, { amount: 10 });
    const { step } = await pendingStep(executed.requestId);

    await act(mgr1.token, step.id, 'approve').expect(200);
    await act(mgr1.token, step.id, 'approve').expect(409); // twice

    await act(fin1.token, step.id, 'approve').expect(403); // not a Manager
  });

  it('any-quorum concurrency: simultaneous approvals — exactly one decides', async () => {
    const graph = {
      nodes: [
        { id: 'start', type: 'start' },
        { id: 'mgr', type: 'approval', config: { roleId: mgrRole, quorum: 'any' } },
      ],
      edges: [{ from: 'start', to: 'mgr' }],
    };
    const workflowId = await publishWorkflow(graph);
    const context = await publishBoundRule(workflowId);
    const executed = await execute(context, { amount: 10 });
    const { step } = await pendingStep(executed.requestId);

    const [a, b] = await Promise.all([
      act(mgr1.token, step.id, 'approve'),
      act(mgr2.token, step.id, 'approve'),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses[0]).toBe(200);
    expect(statuses[1]).toBe(409);

    const detail = await request(server())
      .get(`/api/v1/requests/${executed.requestId}`)
      .set(auth(admin.accessToken))
      .expect(200);
    expect(detail.body.status).toBe('approved');
    // exactly one deciding approval recorded
    expect(
      detail.body.steps[0].actions.filter(
        (action: { action: string }) => action.action === 'approve',
      ),
    ).toHaveLength(1);
  });

  it('n-of-m quorum: needs exactly n approvals', async () => {
    const graph = {
      nodes: [
        { id: 'start', type: 'start' },
        { id: 'mgr', type: 'approval', config: { roleId: mgrRole, quorum: { n: 2 } } },
      ],
      edges: [{ from: 'start', to: 'mgr' }],
    };
    const workflowId = await publishWorkflow(graph);
    const context = await publishBoundRule(workflowId);
    const executed = await execute(context, { amount: 10 });
    const { step } = await pendingStep(executed.requestId);

    const first = await act(mgr1.token, step.id, 'approve').expect(200);
    expect(first.body.status).toBe('pending'); // 1 of 2

    const second = await act(mgr2.token, step.id, 'approve').expect(200);
    expect(second.body.status).toBe('approved'); // 2 of 2
  });

  it('parallel branches: the join waits for BOTH approvals', async () => {
    const graph = {
      nodes: [
        { id: 'start', type: 'start' },
        { id: 'fork', type: 'parallel' },
        { id: 'mgr', type: 'approval', config: { roleId: mgrRole, quorum: 'any' } },
        { id: 'fin', type: 'approval', config: { roleId: finRole, quorum: 'any' } },
        { id: 'done', type: 'auto_approve' },
      ],
      edges: [
        { from: 'start', to: 'fork' },
        { from: 'fork', to: 'mgr' },
        { from: 'fork', to: 'fin' },
        { from: 'mgr', to: 'done' },
        { from: 'fin', to: 'done' },
      ],
    };
    const workflowId = await publishWorkflow(graph);
    const context = await publishBoundRule(workflowId);
    const executed = await execute(context, { amount: 10 });

    // Both steps open simultaneously
    expect(executed.pendingApprovers).toHaveLength(2);

    const { step: mgrStep } = await pendingStep(executed.requestId, 'mgr');
    const afterMgr = await act(mgr1.token, mgrStep.id, 'approve').expect(200);
    expect(afterMgr.body.status).toBe('pending'); // join not ready

    const { step: finStep } = await pendingStep(executed.requestId, 'fin');
    const afterFin = await act(fin1.token, finStep.id, 'approve').expect(200);
    expect(afterFin.body.status).toBe('approved'); // join fired
  });

  it('any_reject_kills: a rejection closes the request and open steps; comment required', async () => {
    const workflowId = await publishWorkflow(threeTierGraph());
    const context = await publishBoundRule(workflowId);
    const executed = await execute(context, { amount: 10 });
    const { step } = await pendingStep(executed.requestId, 'mgr');

    await act(mgr1.token, step.id, 'reject').expect(400); // no comment

    const rejected = await act(mgr1.token, step.id, 'reject', {
      comment: 'Wrong cost center',
    }).expect(200);
    expect(rejected.body.status).toBe('rejected');

    // Later tiers never opened; nothing pending remains
    const detail = await request(server())
      .get(`/api/v1/requests/${executed.requestId}`)
      .set(auth(admin.accessToken))
      .expect(200);
    expect(
      detail.body.steps.filter((s: { status: string }) => s.status === 'pending'),
    ).toHaveLength(0);
  });

  it('reject_returns_to_previous_step: rejection reopens the previous tier', async () => {
    const graph = {
      nodes: [
        { id: 'start', type: 'start' },
        { id: 'mgr', type: 'approval', config: { roleId: mgrRole, quorum: 'any' } },
        { id: 'fin', type: 'approval', config: { roleId: finRole, quorum: 'any' } },
      ],
      edges: [
        { from: 'start', to: 'mgr' },
        { from: 'mgr', to: 'fin' },
      ],
    };
    const workflowId = await publishWorkflow(graph, 'reject_returns_to_previous_step');
    const context = await publishBoundRule(workflowId);
    const executed = await execute(context, { amount: 10 });

    let { step } = await pendingStep(executed.requestId, 'mgr');
    await act(mgr1.token, step.id, 'approve').expect(200);

    ({ step } = await pendingStep(executed.requestId, 'fin'));
    const returned = await act(fin1.token, step.id, 'reject', {
      comment: 'Need a revised quote',
    }).expect(200);
    expect(returned.body.status).toBe('pending'); // back to manager, not dead

    // A fresh manager step is open; the old one is superseded
    const detail = await request(server())
      .get(`/api/v1/requests/${executed.requestId}`)
      .set(auth(admin.accessToken))
      .expect(200);
    const mgrSteps = detail.body.steps.filter((s: { nodeId: string }) => s.nodeId === 'mgr');
    expect(mgrSteps.map((s: { status: string }) => s.status).sort()).toEqual([
      'pending',
      'superseded',
    ]);

    // Round 2 completes
    ({ step } = await pendingStep(executed.requestId, 'mgr'));
    await act(mgr2.token, step.id, 'approve').expect(200);
    ({ step } = await pendingStep(executed.requestId, 'fin'));
    const final = await act(fin1.token, step.id, 'approve').expect(200);
    expect(final.body.status).toBe('approved');
  }, 15000);

  it('out-of-office delegation: delegate acts, audit records both identities', async () => {
    const outsiderRole = await createRole(app, admin.accessToken, 'Outsider');
    const outsider = await createUserWithRoles(app, admin.accessToken, 'ooo', [outsiderRole]);

    // fin1 is out of office and delegates to the outsider
    await request(server())
      .post('/api/v1/delegations')
      .set(auth(fin1.token))
      .send({
        toUserId: outsider.userId,
        startsAt: new Date(Date.now() - 3600_000).toISOString(),
        endsAt: new Date(Date.now() + 3600_000).toISOString(),
      })
      .expect(201);

    const graph = {
      nodes: [
        { id: 'start', type: 'start' },
        { id: 'fin', type: 'approval', config: { roleId: finRole, quorum: 'any' } },
      ],
      edges: [{ from: 'start', to: 'fin' }],
    };
    const workflowId = await publishWorkflow(graph);
    const context = await publishBoundRule(workflowId);
    const executed = await execute(context, { amount: 10 });
    const { step } = await pendingStep(executed.requestId);

    const approved = await act(outsider.token, step.id, 'approve').expect(200);
    expect(approved.body.status).toBe('approved');

    const action = approved.body.steps[0].actions.find(
      (candidate: { action: string }) => candidate.action === 'approve',
    );
    expect(action.actorUserId).toBe(outsider.userId);
    expect(action.onBehalfOfUserId).toBe(fin1.userId); // both identities on record
  }, 15000);

  it('ad-hoc step delegation hands the step to a specific user', async () => {
    const helperRole = await createRole(app, admin.accessToken, 'Helper');
    const helper = await createUserWithRoles(app, admin.accessToken, 'helper', [helperRole]);

    const graph = {
      nodes: [
        { id: 'start', type: 'start' },
        { id: 'mgr', type: 'approval', config: { roleId: mgrRole, quorum: 'any' } },
      ],
      edges: [{ from: 'start', to: 'mgr' }],
    };
    const workflowId = await publishWorkflow(graph);
    const context = await publishBoundRule(workflowId);
    const executed = await execute(context, { amount: 10 });
    const { step } = await pendingStep(executed.requestId);

    await act(helper.token, step.id, 'approve').expect(403); // not yet
    await act(mgr1.token, step.id, 'delegate', { toUserId: helper.userId }).expect(200);
    const approved = await act(helper.token, step.id, 'approve').expect(200);
    expect(approved.body.status).toBe('approved');
  }, 15000);

  it('cancellation closes open steps; acting afterwards is a conflict', async () => {
    const workflowId = await publishWorkflow(threeTierGraph());
    const context = await publishBoundRule(workflowId);
    const executed = await execute(context, { amount: 10 });
    const { step } = await pendingStep(executed.requestId);

    const cancelled = await request(server())
      .post(`/api/v1/requests/${executed.requestId}/cancel`)
      .set(auth(admin.accessToken))
      .expect(200);
    expect(cancelled.body.status).toBe('cancelled');

    await act(mgr1.token, step.id, 'approve').expect(409);
  });

  it('workflow version pinning: mid-flight requests stay on their version', async () => {
    const workflowId = await publishWorkflow(threeTierGraph());
    const context = await publishBoundRule(workflowId);
    const executed = await execute(context, { amount: 10 });

    // v2 becomes a single auto-approve — drastic change
    await request(server())
      .put(`/api/v1/workflows/${workflowId}/draft`)
      .set(auth(admin.accessToken))
      .send({
        graph: {
          nodes: [
            { id: 'start', type: 'start' },
            { id: 'done', type: 'auto_approve' },
          ],
          edges: [{ from: 'start', to: 'done' }],
        },
        rejectionPolicy: 'any_reject_kills',
      })
      .expect(200);
    await request(server())
      .post(`/api/v1/workflows/${workflowId}/publish`)
      .set(auth(admin.accessToken))
      .expect(200);

    // The running request still walks the pinned 3-tier v1
    let { step } = await pendingStep(executed.requestId, 'mgr');
    await act(mgr1.token, step.id, 'approve').expect(200);
    ({ step } = await pendingStep(executed.requestId, 'fin'));
    expect(step).toBeTruthy(); // v1's second tier, not v2's auto-approve

    // A NEW request uses v2 and approves instantly with zero steps
    const fresh = await execute(context, { amount: 10 });
    expect(fresh.status).toBe('approved');
    expect(fresh.pendingApprovers).toHaveLength(0);
  }, 15000);

  it('condition_branch routes by payload', async () => {
    const graph = {
      nodes: [
        { id: 'start', type: 'start' },
        { id: 'route', type: 'condition_branch' },
        { id: 'cfo', type: 'approval', config: { roleId: cfoRole, quorum: 'any' } },
        { id: 'mgr', type: 'approval', config: { roleId: mgrRole, quorum: 'any' } },
      ],
      edges: [
        { from: 'start', to: 'route' },
        {
          from: 'route',
          to: 'cfo',
          condition: { field: 'amount', operator: '>', value: 100000 },
        },
        { from: 'route', to: 'mgr', isDefault: true },
      ],
    };
    const workflowId = await publishWorkflow(graph);
    const context = await publishBoundRule(workflowId, -1);

    const big = await execute(context, { amount: 500000 });
    expect(big.pendingApprovers[0].roleId).toBe(cfoRole);

    const small = await execute(context, { amount: 50 });
    expect(small.pendingApprovers[0].roleId).toBe(mgrRole);
  });

  it('condition_branch: compound conditions + first-match precedence', async () => {
    const graph = {
      nodes: [
        { id: 'start', type: 'start' },
        { id: 'route', type: 'condition_branch' },
        { id: 'cfo', type: 'approval', config: { roleId: cfoRole, quorum: 'any' } },
        { id: 'fin', type: 'approval', config: { roleId: finRole, quorum: 'any' } },
        { id: 'mgr', type: 'approval', config: { roleId: mgrRole, quorum: 'any' } },
      ],
      edges: [
        { from: 'start', to: 'route' },
        {
          // multi-condition (AND group) — must beat the broader edge below by order
          from: 'route',
          to: 'cfo',
          condition: {
            operator: 'AND',
            children: [
              { field: 'amount', operator: '>', value: 100000 },
              { field: 'category', operator: '=', value: 'capex' },
            ],
          },
        },
        { from: 'route', to: 'fin', condition: { field: 'amount', operator: '>', value: 100000 } },
        { from: 'route', to: 'mgr', isDefault: true },
      ],
    };
    const workflowId = await publishWorkflow(graph);
    const context = await publishBoundRule(workflowId, -1);

    // Both conditional edges match — the first declared wins (exclusive branch)
    const capex = await execute(context, { amount: 500000, category: 'capex' });
    expect(capex.pendingApprovers[0].roleId).toBe(cfoRole);

    // Only the second edge matches
    const opex = await execute(context, { amount: 500000, category: 'opex' });
    expect(opex.pendingApprovers[0].roleId).toBe(finRole);

    // Nothing matches → default
    const small = await execute(context, { amount: 5, category: 'opex' });
    expect(small.pendingApprovers[0].roleId).toBe(mgrRole);
  });

  it('condition_branch: dead end (no match, no default) rejects the request', async () => {
    const graph = {
      nodes: [
        { id: 'start', type: 'start' },
        { id: 'route', type: 'condition_branch' },
        { id: 'cfo', type: 'approval', config: { roleId: cfoRole, quorum: 'any' } },
      ],
      edges: [
        { from: 'start', to: 'route' },
        { from: 'route', to: 'cfo', condition: { field: 'amount', operator: '>', value: 100000 } },
      ],
    };
    const workflowId = await publishWorkflow(graph);
    const context = await publishBoundRule(workflowId, -1);

    const stranded = await execute(context, { amount: 50 });
    expect(stranded.status).toBe('rejected');
    expect(stranded.pendingApprovers).toHaveLength(0);
  });

  it('inbox: shows actionable steps, never your own requests, clears after acting', async () => {
    const graph = {
      nodes: [
        { id: 'start', type: 'start' },
        { id: 'mgr', type: 'approval', config: { roleId: mgrRole, quorum: 'any' } },
      ],
      edges: [{ from: 'start', to: 'mgr' }],
    };
    const workflowId = await publishWorkflow(graph);
    const context = await publishBoundRule(workflowId);
    const executed = await execute(context, { amount: 10 });

    const mgrInbox = await request(server()).get('/api/v1/inbox').set(auth(mgr1.token)).expect(200);
    const stepIds = mgrInbox.body.items.map((item: { id: string }) => item.id);
    const { step } = await pendingStep(executed.requestId);
    expect(stepIds).toContain(step.id);

    // The creator sees nothing of their own request
    const creatorInbox = await request(server())
      .get('/api/v1/inbox')
      .set(auth(admin.accessToken))
      .expect(200);
    expect(creatorInbox.body.items.map((item: { id: string }) => item.id)).not.toContain(step.id);

    await act(mgr1.token, step.id, 'approve').expect(200);
    const after = await request(server()).get('/api/v1/inbox').set(auth(mgr1.token)).expect(200);
    expect(after.body.items.map((item: { id: string }) => item.id)).not.toContain(step.id);
  });

  it('POST /requests creates directly against a named workflow (with idempotency)', async () => {
    const workflowId = await publishWorkflow(threeTierGraph());
    const key = unique('direct');

    const first = await request(server())
      .post('/api/v1/requests')
      .set(auth(admin.accessToken))
      .set('Idempotency-Key', key)
      .send({ workflowId, payload: { amount: 123 }, title: 'Direct request' })
      .expect(201);
    expect(first.body.requestId).toBeTruthy();
    expect(first.body.pendingApprovers).toHaveLength(1);

    const replay = await request(server())
      .post('/api/v1/requests')
      .set(auth(admin.accessToken))
      .set('Idempotency-Key', key)
      .send({ workflowId, payload: { amount: 123 }, title: 'Direct request' })
      .expect(201);
    expect(replay.body.requestId).toBe(first.body.requestId);
  });

  it('a matched rule without a workflow binding fails with a pointed 422', async () => {
    const context = `CTX_${Date.now()}_UNBOUND`;
    const rule = await request(server())
      .post('/api/v1/rules')
      .set(auth(admin.accessToken))
      .send({
        name: `unbound ${unique('r')}`,
        context,
        conditionAst: { field: 'amount', operator: '>', value: 0 },
      })
      .expect(201);
    await request(server())
      .post(`/api/v1/rules/${rule.body.id}/publish`)
      .set(auth(admin.accessToken))
      .expect(200);

    const res = await request(server())
      .post('/api/v1/evaluate')
      .set(auth(admin.accessToken))
      .send({ context, data: { amount: 5 }, mode: 'execute' })
      .expect(422);
    expect(res.body.message).toContain('no published workflow bound');
  });

  it('cross-tenant request fetch by UUID is a 404', async () => {
    const workflowId = await publishWorkflow(threeTierGraph());
    const context = await publishBoundRule(workflowId);
    const executed = await execute(context, { amount: 10 });

    const other = await signupTenant(app, 'eng-b');
    await request(server())
      .get(`/api/v1/requests/${executed.requestId}`)
      .set(auth(other.accessToken))
      .expect(404);
  });
});
