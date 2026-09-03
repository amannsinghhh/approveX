import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
 * P0.1 Request Portal (e2e) — the self-service surface for any authenticated
 * human: which contexts they can submit into, the generated form for one, the
 * submit path (which routes through the normal rule-match → workflow engine),
 * and the "my requests" ledger. Covers the projection rules (input-type
 * fallback, required-from-nullable, display ordering), the injection/validation
 * guards on submit, dot-path nesting, and per-user / per-tenant isolation.
 */
describe('Request Portal (e2e)', () => {
  let app: INestApplication;
  let admin: SignedUpTenant;

  const server = () => app.getHttpServer();

  // A fresh context per test so tenant-global fields/rules never interfere.
  const ctx = (label: string): string =>
    `PORTAL_${label.toUpperCase()}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;

  /** Register a field (defaults it user-submittable + scoped to `context`). */
  const createField = async (
    body: Record<string, unknown>,
    token = admin.accessToken,
  ): Promise<void> => {
    await request(server())
      .post('/api/v1/fields')
      .set(auth(token))
      .send({ userSubmittable: true, ...body })
      .expect(201);
  };

  /**
   * Publish a one-approval-tier workflow bound to a fresh role that has a
   * distinct approver member — so a request routed here always has an eligible
   * approver (the submitter can't approve their own) and lands `pending`.
   */
  const publishWorkflow = async (): Promise<string> => {
    const roleId = await createRole(app, admin.accessToken, 'Approver');
    await createUserWithRoles(app, admin.accessToken, 'approver', [roleId]);
    const graph = {
      nodes: [
        { id: 'start', type: 'start' },
        { id: 'mgr', type: 'approval', config: { roleId, quorum: 'any', slaHours: 48 } },
        { id: 'done', type: 'auto_approve' },
      ],
      edges: [
        { from: 'start', to: 'mgr' },
        { from: 'mgr', to: 'done' },
      ],
    };
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

  /** Publish a rule in `context`; optionally bind a workflow so execute routes. */
  const publishRule = async (
    context: string,
    conditionAst: unknown,
    workflowId?: string,
  ): Promise<void> => {
    const rule = await request(server())
      .post('/api/v1/rules')
      .set(auth(admin.accessToken))
      .send({ name: `rule ${unique('r')}`, context, conditionAst })
      .expect(201);
    if (workflowId) {
      await request(server())
        .put(`/api/v1/rules/${rule.body.id}/binding`)
        .set(auth(admin.accessToken))
        .send({ workflowId })
        .expect(200);
    }
    await request(server())
      .post(`/api/v1/rules/${rule.body.id}/publish`)
      .set(auth(admin.accessToken))
      .expect(200);
  };

  const getContexts = async (token = admin.accessToken) =>
    (await request(server()).get('/api/v1/portal/contexts').set(auth(token)).expect(200)).body;

  const getForm = (context: string, token = admin.accessToken) =>
    request(server())
      .get(`/api/v1/portal/contexts/${encodeURIComponent(context)}`)
      .set(auth(token));

  const submit = (context: string, body: Record<string, unknown>, token = admin.accessToken) =>
    request(server())
      .post(`/api/v1/portal/contexts/${encodeURIComponent(context)}/requests`)
      .set(auth(token))
      .send(body);

  const myRequests = (query = '', token = admin.accessToken) =>
    request(server())
      .get(`/api/v1/portal/my-requests${query}`)
      .set(auth(token));

  beforeAll(async () => {
    app = await createTestApp();
    admin = await signupTenant(app, 'portal');
  }, 30000);

  afterAll(async () => {
    await app.close();
  });

  describe('GET /portal/contexts', () => {
    it('surfaces only contexts with a user-submittable field, with counts, sorted', async () => {
      const a = ctx('list_a');
      const b = ctx('list_b');
      // Two submittable fields on A, one on B.
      await createField({ name: `amount_${Date.now()}`, type: 'number', contexts: [a, b] });
      await createField({ name: `vendor_${Date.now()}`, type: 'string', contexts: [a] });
      // A non-submittable field in its own context must NOT appear.
      const hidden = ctx('list_hidden');
      await createField({
        name: `secret_${Date.now()}`,
        type: 'string',
        userSubmittable: false,
        contexts: [hidden],
      });

      const body = await getContexts();
      const mine = body.items.filter((i: { context: string }) => [a, b, hidden].includes(i.context));
      expect(mine).toEqual([
        { context: a, fieldCount: 2 },
        { context: b, fieldCount: 1 },
      ]);
      expect(mine.map((i: { context: string }) => i.context)).not.toContain(hidden);
    });
  });

  describe('GET /portal/contexts/:context', () => {
    it('404s when no submittable form is configured for the context', async () => {
      await getForm(ctx('noform')).expect(404);
    });

    it('projects fields: input-type fallback, required-from-nullable, display order', async () => {
      const context = ctx('form');
      // Ordering: displayOrder asc (nulls last), then name. Insert out of order.
      await createField({
        name: `zeta_${Date.now()}`,
        type: 'string',
        contexts: [context],
        displayOrder: 2,
        label: 'Zeta',
        nullable: true,
      });
      await createField({
        name: `alpha_${Date.now()}`,
        type: 'number',
        unit: 'currency:INR',
        precision: 2,
        contexts: [context],
        displayOrder: 1,
        helpText: 'in rupees',
        nullable: false,
      });
      await createField({
        name: `omega_${Date.now()}`,
        type: 'string',
        enumValues: ['LOW', 'HIGH'],
        contexts: [context],
        // no displayOrder → sorts last
      });

      const { body } = await getForm(context).expect(200);
      expect(body.context).toBe(context);
      expect(body.fields).toHaveLength(3);
      const [first, second, third] = body.fields;

      // alpha (displayOrder 1): currency unit → currency control; not nullable → required.
      expect(first).toMatchObject({
        inputType: 'currency',
        type: 'number',
        required: true,
        unit: 'currency:INR',
        precision: 2,
        helpText: 'in rupees',
      });
      // zeta (displayOrder 2): plain text; nullable → not required; label falls through.
      expect(second).toMatchObject({ inputType: 'text', required: false, label: 'Zeta' });
      // omega (null displayOrder → last): enum values → select; label defaults to name.
      expect(third.inputType).toBe('select');
      expect(third.enumValues).toEqual(['LOW', 'HIGH']);
      expect(third.label).toBe(third.name);
    });

    it('an explicit inputType overrides the storage-type fallback', async () => {
      const context = ctx('override');
      await createField({
        name: `notes_${Date.now()}`,
        type: 'string',
        inputType: 'textarea',
        contexts: [context],
      });
      const { body } = await getForm(context).expect(200);
      expect(body.fields[0].inputType).toBe('textarea');
    });
  });

  describe('POST /portal/contexts/:context/requests', () => {
    it('routes a submission through rule-matching into a pending request', async () => {
      const context = ctx('submit_ok');
      const amount = `amount_${Date.now()}`;
      await createField({ name: amount, type: 'number', contexts: [context], nullable: false });
      const workflowId = await publishWorkflow();
      await publishRule(context, { field: amount, operator: '>', value: 0 }, workflowId);

      const res = await submit(context, { data: { [amount]: 5000 } }).expect(201);

      expect(res.body.requestId).toBeTruthy();
      expect(res.body.status).toBe('pending');
      expect(res.body.pendingApprovers).toHaveLength(1);

      // It surfaces in the submitter's own ledger, with its pending step.
      const mine = await myRequests(`?context=${encodeURIComponent(context)}`).expect(200);
      expect(mine.body.total).toBe(1);
      expect(mine.body.items[0]).toMatchObject({
        id: res.body.requestId,
        context,
        status: 'pending',
      });
      expect(mine.body.items[0].pendingSteps).toHaveLength(1);
    });

    // NOTE (known gap): `title` and `externalRef` are accepted by
    // submitRequestSchema and documented as "shown in inboxes and lists", but
    // PortalService.submit never forwards them to evaluate(), and evaluate()'s
    // engine.instantiate() call omits them too — so they are silently dropped
    // and the created request stores null for both. This test pins that CURRENT
    // behaviour; if the wiring is fixed, flip the expectations to the values below.
    it('accepts but does not yet persist title / externalRef (known gap)', async () => {
      const context = ctx('meta');
      const amount = `amount_${Date.now()}`;
      await createField({ name: amount, type: 'number', contexts: [context], nullable: false });
      const workflowId = await publishWorkflow();
      await publishRule(context, { field: amount, operator: '>', value: 0 }, workflowId);

      const res = await submit(context, {
        data: { [amount]: 5000 },
        title: 'Laptop stand',
        externalRef: 'TICKET-1',
      }).expect(201);

      const mine = await myRequests(`?context=${encodeURIComponent(context)}`).expect(200);
      const item = mine.body.items.find((r: { id: string }) => r.id === res.body.requestId);
      expect(item).toBeTruthy();
      // Documents the drop — NOT an endorsement. See NOTE above.
      expect(item.title).toBeNull();
      expect(item.externalRef).toBeNull();
    });

    it('nests dot-path field names so the evaluator resolves them (setPath)', async () => {
      const context = ctx('dotpath');
      await createField({ name: 'vendor.country', type: 'string', contexts: [context] });
      const workflowId = await publishWorkflow();
      await publishRule(
        context,
        { field: 'vendor.country', operator: '=', value: 'India' },
        workflowId,
      );

      const res = await submit(context, { data: { 'vendor.country': 'India' } }).expect(201);
      expect(res.body.requestId).toBeTruthy();
      expect(res.body.status).toBe('pending');
    });

    it('a submission that matches no rule creates nothing (null request)', async () => {
      const context = ctx('nomatch');
      await createField({ name: `amount_${Date.now()}`, type: 'number', contexts: [context] });
      // No rule published for this context.
      const res = await submit(context, { data: {} }).expect(201);
      expect(res.body.requestId).toBeNull();
      expect(res.body.status).toBeNull();
      expect(res.body.pendingApprovers).toBeNull();
    });

    it('rejects keys that are not submittable on the context (injection guard)', async () => {
      const context = ctx('injection');
      const ok = `amount_${Date.now()}`;
      await createField({ name: ok, type: 'number', contexts: [context] });
      const res = await submit(context, {
        data: { [ok]: 1, secretApproved: true },
      }).expect(400);
      expect(JSON.stringify(res.body)).toContain('secretApproved');
    });

    it('rejects a submission missing a required field', async () => {
      const context = ctx('required');
      const need = `amount_${Date.now()}`;
      await createField({ name: need, type: 'number', contexts: [context], nullable: false });
      const res = await submit(context, { data: {} }).expect(400);
      expect(JSON.stringify(res.body)).toContain(need);
    });

    it('404s when the context has no submittable form at all', async () => {
      await submit(ctx('submit_noform'), { data: {} }).expect(404);
    });
  });

  describe('GET /portal/my-requests', () => {
    it('shows only the caller-submitted requests, filterable and paginated', async () => {
      const context = ctx('ledger');
      const amount = `amount_${Date.now()}`;
      await createField({ name: amount, type: 'number', contexts: [context], nullable: false });
      const workflowId = await publishWorkflow();
      await publishRule(context, { field: amount, operator: '>', value: 0 }, workflowId);

      // A second human in the same tenant submits into the same context.
      const peerRole = await createRole(app, admin.accessToken, 'Peer');
      const other: TestUser = await createUserWithRoles(app, admin.accessToken, 'peer', [
        peerRole,
      ]);

      const mine1 = await submit(context, { data: { [amount]: 10 } }).expect(201);
      const mine2 = await submit(context, { data: { [amount]: 20 } }).expect(201);
      const theirOne = await submit(context, { data: { [amount]: 30 } }, other.token).expect(201);

      // Admin sees only its own two (by createdById) — not the peer's request.
      const mine = await myRequests(`?context=${encodeURIComponent(context)}`).expect(200);
      expect(mine.body.total).toBe(2);
      expect(mine.body.items.map((r: { id: string }) => r.id).sort()).toEqual(
        [mine1.body.requestId, mine2.body.requestId].sort(),
      );

      // The peer sees only theirs.
      const theirs = await myRequests(
        `?context=${encodeURIComponent(context)}`,
        other.token,
      ).expect(200);
      expect(theirs.body.total).toBe(1);
      expect(theirs.body.items[0].id).toBe(theirOne.body.requestId);

      // Pagination honours page/pageSize and still reports the true total.
      const paged = await myRequests(
        `?context=${encodeURIComponent(context)}&page=1&pageSize=1`,
      ).expect(200);
      expect(paged.body.total).toBe(2);
      expect(paged.body.items).toHaveLength(1);
      expect(paged.body.page).toBe(1);
      expect(paged.body.pageSize).toBe(1);

      // A status filter that matches nothing yields an empty page.
      const rejected = await myRequests(
        `?context=${encodeURIComponent(context)}&status=rejected`,
      ).expect(200);
      expect(rejected.body.total).toBe(0);
    });

    it('rejects an out-of-range page size (schema-validated query)', async () => {
      await myRequests('?pageSize=999').expect(400);
    });
  });

  describe('tenant isolation', () => {
    it('another tenant never sees this tenant\'s contexts, forms, or requests', async () => {
      const context = ctx('xtenant');
      await createField({ name: `amount_${Date.now()}`, type: 'number', contexts: [context] });

      const other = await signupTenant(app, 'portal-b');

      const contexts = await getContexts(other.accessToken);
      expect(contexts.items.some((i: { context: string }) => i.context === context)).toBe(false);

      await getForm(context, other.accessToken).expect(404);

      const mine = await myRequests('', other.accessToken).expect(200);
      expect(mine.body.total).toBe(0);
    });
  });
});
