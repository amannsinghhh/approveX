import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SignedUpTenant } from './utils';
import { auth, createTestApp, signupTenant, unique } from './utils';

describe('POST /evaluate dry_run (e2e)', () => {
  let app: INestApplication;
  let admin: SignedUpTenant;
  // Each test group gets its own context so published rules don't interfere.
  const ctx = (label: string): string => `CTX_${label.toUpperCase()}_${Date.now()}`;

  const publishRule = async (
    body: Record<string, unknown>,
  ): Promise<{ ruleId: string; version: number }> => {
    const created = await request(app.getHttpServer())
      .post('/api/v1/rules')
      .set(auth(admin.accessToken))
      .send(body)
      .expect(201);
    const published = await request(app.getHttpServer())
      .post(`/api/v1/rules/${created.body.id}/publish`)
      .set(auth(admin.accessToken))
      .expect(200);
    return { ruleId: created.body.id, version: published.body.version };
  };

  const evaluate = async (context: string, data: Record<string, unknown>, extra = {}) => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/evaluate')
      .set(auth(admin.accessToken))
      .send({ context, data, mode: 'dry_run', ...extra })
      .expect(200);
    return res.body;
  };

  beforeAll(async () => {
    app = await createTestApp();
    admin = await signupTenant(app, 'eval');
  });

  afterAll(async () => {
    await app.close();
  });

  it('mode execute with no matching rules returns noMatch without creating anything', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/evaluate')
      .set(auth(admin.accessToken))
      .send({ context: 'ANY', data: {}, mode: 'execute' })
      .expect(200);
    expect(res.body.noMatch).toBe(true);
    expect(res.body.requestId).toBeNull();
  });

  it('no published rules → noMatch with the default policy', async () => {
    const body = await evaluate(ctx('empty'), { amount: 1 });
    expect(body).toMatchObject({
      matched: false,
      noMatch: true,
      noMatchPolicy: 'treat_as_no_match',
      matchedRuleId: null,
      evaluationTrace: null,
    });
  });

  it('matches a rule and returns the full trace (spec example)', async () => {
    const context = ctx('spec');
    const { ruleId } = await publishRule({
      name: `Spec example ${unique('r')}`,
      context,
      priority: 10,
      conditionAst: {
        operator: 'AND',
        children: [
          { field: 'amount', operator: '>', value: 100000 },
          { field: 'country', operator: '=', value: 'India' },
          {
            operator: 'OR',
            children: [
              { field: 'department', operator: 'IN', value: ['Finance', 'Procurement'] },
              { field: 'urgent', operator: '=', value: true },
            ],
          },
        ],
      },
    });

    const body = await evaluate(context, {
      amount: 200000,
      country: 'India',
      department: 'Finance',
    });

    expect(body.matched).toBe(true);
    expect(body.matchedRuleId).toBe(ruleId);
    expect(body.matchedRuleVersion).toBe(1);
    expect(body.priorityUsed).toBe(10);
    expect(body.wouldStartWorkflow).toBeNull();
    // Structured trace (B.5): condition_tree with the leaf/logical nodes
    expect(body.ruleType).toBe('condition_tree');
    expect(body.evaluationTrace.type).toBe('condition_tree');
    expect(body.evaluationTrace.result).toBe(true);
    const nodes = body.evaluationTrace.nodes;
    // Trace covers all 4 comparisons + OR + AND
    expect(nodes).toHaveLength(6);
    const root = nodes.find((e: { nodePath: string }) => e.nodePath === 'root');
    expect(root).toMatchObject({ operator: 'AND', result: true });

    // The urgent leaf shows the missing field
    const urgent = nodes.find((e: { field?: string }) => e.field === 'urgent');
    expect(urgent.notes).toContain('missing_field');
  });

  it('missing referenced field → no match, no 500, trace explains why', async () => {
    const context = ctx('missing');
    await publishRule({
      name: `Needs amount ${unique('r')}`,
      context,
      conditionAst: { field: 'amount', operator: '>', value: 1000 },
    });
    const body = await evaluate(context, { somethingElse: true }, { includeTraces: true });
    expect(body.noMatch).toBe(true);
    expect(body.noMatchPolicy).toBe('treat_as_no_match');
    expect(body.matchesConsidered[0].trace[0].notes).toContain('missing_field');
  });

  it('conflict resolution: priority, then specificity, then age', async () => {
    const context = ctx('conflict');
    // A: priority 20, 1 condition
    const a = await publishRule({
      name: `A ${unique('r')}`,
      context,
      priority: 20,
      conditionAst: { field: 'amount', operator: '>', value: 0 },
    });
    // B: priority 5, 1 condition → wins on priority
    const b = await publishRule({
      name: `B ${unique('r')}`,
      context,
      priority: 5,
      conditionAst: { field: 'amount', operator: '>', value: 1 },
    });
    // C: priority 5, 2 conditions → beats B on specificity
    const c = await publishRule({
      name: `C ${unique('r')}`,
      context,
      priority: 5,
      conditionAst: {
        operator: 'AND',
        children: [
          { field: 'amount', operator: '>', value: 1 },
          { field: 'amount', operator: '<', value: 10_000_000 },
        ],
      },
    });
    // D: priority 5, 2 conditions, created after C → C beats D on age
    const d = await publishRule({
      name: `D ${unique('r')}`,
      context,
      priority: 5,
      conditionAst: {
        operator: 'AND',
        children: [
          { field: 'amount', operator: '>', value: 2 },
          { field: 'amount', operator: '<', value: 9_000_000 },
        ],
      },
    });

    const body = await evaluate(context, { amount: 5000 });
    expect(body.matchedRuleId).toBe(c.ruleId);
    expect(body.priorityUsed).toBe(5);
    // All four were considered and matched — visible in the ranking
    const considered = Object.fromEntries(
      body.matchesConsidered.map((m: { ruleId: string; matched: boolean }) => [
        m.ruleId,
        m.matched,
      ]),
    );
    expect(considered[a.ruleId]).toBe(true);
    expect(considered[b.ruleId]).toBe(true);
    expect(considered[d.ruleId]).toBe(true);
    // Ranking order: C, D (age), B (fewer conditions), A (priority)
    expect(body.matchesConsidered.map((m: { ruleId: string }) => m.ruleId)).toEqual([
      c.ruleId,
      d.ruleId,
      b.ruleId,
      a.ruleId,
    ]);
  });

  it('effective date window excludes expired and not-yet-active rules', async () => {
    const context = ctx('window');
    await publishRule({
      name: `Expired ${unique('r')}`,
      context,
      conditionAst: { field: 'amount', operator: '>', value: 0 },
      effectiveFrom: new Date('2020-01-01').toISOString(),
      effectiveTo: new Date('2021-01-01').toISOString(),
    });
    await publishRule({
      name: `Future ${unique('r')}`,
      context,
      conditionAst: { field: 'amount', operator: '>', value: 0 },
      effectiveFrom: new Date(Date.now() + 86400_000).toISOString(),
    });
    const body = await evaluate(context, { amount: 100 });
    expect(body.noMatch).toBe(true);
    expect(body.matchesConsidered).toHaveLength(0);
  });

  it('draft rules are never considered', async () => {
    const context = ctx('draft');
    await request(app.getHttpServer())
      .post('/api/v1/rules')
      .set(auth(admin.accessToken))
      .send({
        name: `Draft only ${unique('r')}`,
        context,
        conditionAst: { field: 'amount', operator: '>', value: 0 },
      })
      .expect(201);
    const body = await evaluate(context, { amount: 100 });
    expect(body.noMatch).toBe(true);
  });

  it('field registry drives numeric-string coercion', async () => {
    const context = ctx('coerce');
    const fieldName = `amt_${Date.now()}`;
    await request(app.getHttpServer())
      .post('/api/v1/fields')
      .set(auth(admin.accessToken))
      .send({ name: fieldName, type: 'number' })
      .expect(201);
    await publishRule({
      name: `Coerced ${unique('r')}`,
      context,
      conditionAst: { field: fieldName, operator: '>', value: 100000 },
    });

    // Numeric string matches because the field is registered numeric
    const hit = await evaluate(context, { [fieldName]: '200000' });
    expect(hit.matched).toBe(true);

    // Unregistered fields get no coercion — prove it via a fresh context
    const context2 = ctx('nocoerce');
    await publishRule({
      name: `Uncoerced ${unique('r')}`,
      context: context2,
      conditionAst: { field: 'rawAmount', operator: '>', value: 100000 },
    });
    const miss = await evaluate(context2, { rawAmount: '200000' }, { includeTraces: true });
    expect(miss.matched).toBe(false);
    expect(miss.matchesConsidered[0].trace[0].notes).toContain('type_mismatch');
  });

  it('publish invalidates the cache: new version takes effect immediately', async () => {
    const context = ctx('cache');
    const { ruleId } = await publishRule({
      name: `Cache test ${unique('r')}`,
      context,
      conditionAst: { field: 'amount', operator: '>', value: 100 },
    });

    // Warm the cache
    const before = await evaluate(context, { amount: 500 });
    expect(before.matched).toBe(true);
    expect(before.matchedRuleVersion).toBe(1);

    // v2 raises the threshold above the payload
    await request(app.getHttpServer())
      .put(`/api/v1/rules/${ruleId}/draft`)
      .set(auth(admin.accessToken))
      .send({ conditionAst: { field: 'amount', operator: '>', value: 1000 } })
      .expect(200);
    await request(app.getHttpServer())
      .post(`/api/v1/rules/${ruleId}/publish`)
      .set(auth(admin.accessToken))
      .expect(200);

    const after = await evaluate(context, { amount: 500 });
    expect(after.matched).toBe(false);

    const afterHigh = await evaluate(context, { amount: 5000 });
    expect(afterHigh.matched).toBe(true);
    expect(afterHigh.matchedRuleVersion).toBe(2);
  });

  it('archiving removes a rule from evaluation immediately', async () => {
    const context = ctx('archive');
    const { ruleId } = await publishRule({
      name: `To archive ${unique('r')}`,
      context,
      conditionAst: { field: 'amount', operator: '>', value: 0 },
    });
    expect((await evaluate(context, { amount: 1 })).matched).toBe(true);

    await request(app.getHttpServer())
      .post(`/api/v1/rules/${ruleId}/archive`)
      .set(auth(admin.accessToken))
      .expect(200);
    expect((await evaluate(context, { amount: 1 })).noMatch).toBe(true);
  });

  it('dry runs leave exactly one audit event and nothing else', async () => {
    const context = ctx('audit');
    await evaluate(context, { amount: 1 });
    const audit = await request(app.getHttpServer())
      .get('/api/v1/audit?entity=evaluation')
      .set(auth(admin.accessToken))
      .expect(200);
    const events = audit.body.items.filter(
      (e: { eventType: string; after: { context?: string } }) =>
        e.eventType === 'evaluate.dry_run' && e.after?.context === context,
    );
    expect(events).toHaveLength(1);
  });

  it('cross-tenant isolation: another tenant with the same context sees nothing', async () => {
    const context = ctx('xtenant');
    await publishRule({
      name: `Tenant A rule ${unique('r')}`,
      context,
      conditionAst: { field: 'amount', operator: '>', value: 0 },
    });

    const other = await signupTenant(app, 'eval-b');
    const res = await request(app.getHttpServer())
      .post('/api/v1/evaluate')
      .set(auth(other.accessToken))
      .send({ context, data: { amount: 100 }, mode: 'dry_run' })
      .expect(200);
    expect(res.body.noMatch).toBe(true);
    expect(res.body.matchesConsidered).toHaveLength(0);
  });
});
