import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SignedUpTenant } from './utils';
import { auth, createTestApp, signupTenant, unique } from './utils';

/** Addendum M2: scoring rules — a weighted score measured against a threshold. */
describe('Scoring rules (e2e)', () => {
  let app: INestApplication;
  let admin: SignedUpTenant;
  const ctx = (label: string): string => `SCORE_${label.toUpperCase()}_${Date.now()}`;

  /** Risk score out of 100: amount tiers + category + a new-vendor flag. */
  const riskSpec = {
    threshold: 60,
    factors: [
      {
        field: 'amount',
        weight: 50,
        scoringFunction: {
          type: 'bands',
          bands: [{ upTo: 10000, score: 0 }, { upTo: 100000, score: 0.5 }, { score: 1 }],
        },
      },
      {
        field: 'category',
        weight: 30,
        scoringFunction: { type: 'map', values: { travel: 0.2, consulting: 1 }, default: 0.5 },
      },
      {
        field: 'newVendor',
        weight: 20,
        scoringFunction: { type: 'boolean', whenTrue: 1, whenFalse: 0 },
      },
    ],
  };

  const createRule = (body: Record<string, unknown>) =>
    request(app.getHttpServer()).post('/api/v1/rules').set(auth(admin.accessToken)).send(body);

  const publishRule = async (body: Record<string, unknown>): Promise<string> => {
    const created = await createRule(body).expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/rules/${created.body.id}/publish`)
      .set(auth(admin.accessToken))
      .expect(200);
    return created.body.id;
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
    admin = await signupTenant(app, 'scoring');
  });

  afterAll(async () => {
    await app.close();
  });

  it('creates a scoring rule and reports its type on the version', async () => {
    const res = await createRule({
      name: `Risk score ${unique('r')}`,
      context: ctx('create'),
      ruleType: 'scoring',
      scoringSpec: riskSpec,
    }).expect(201);

    expect(res.body.latestVersion).toMatchObject({ ruleType: 'scoring', conditionAst: null });
    expect(res.body.latestVersion.scoringSpec.threshold).toBe(60);
  });

  it('defaults to a condition tree when ruleType is omitted', async () => {
    const res = await createRule({
      name: `Plain ${unique('r')}`,
      context: ctx('default'),
      conditionAst: { field: 'amount', operator: '>', value: 1 },
    }).expect(201);
    expect(res.body.latestVersion).toMatchObject({ ruleType: 'condition_tree', scoringSpec: null });
  });

  it('rejects a payload that does not match its rule type', async () => {
    // scoring without a spec
    await createRule({
      name: `Bad ${unique('r')}`,
      context: ctx('mismatch'),
      ruleType: 'scoring',
      conditionAst: { field: 'amount', operator: '>', value: 1 },
    }).expect(400);

    // condition tree carrying a scoring spec
    await createRule({
      name: `Bad ${unique('r')}`,
      context: ctx('mismatch'),
      ruleType: 'condition_tree',
      conditionAst: { field: 'amount', operator: '>', value: 1 },
      scoringSpec: riskSpec,
    }).expect(400);
  });

  it('rejects a malformed scoring spec with per-factor issues', async () => {
    const res = await createRule({
      name: `Malformed ${unique('r')}`,
      context: ctx('invalid'),
      ruleType: 'scoring',
      scoringSpec: {
        threshold: 10,
        // bands must ascend and end with an open catch-all
        factors: [
          {
            field: 'amount',
            weight: 1,
            scoringFunction: { type: 'bands', bands: [{ upTo: 100, score: 1 }] },
          },
        ],
      },
    }).expect(400);

    expect(res.body.message).toBe('Invalid scoring spec');
    expect(res.body.issues[0]).toMatchObject({ path: 'factors[0]' });
  });

  it('matches when the weighted total clears the threshold, with a full breakdown', async () => {
    const context = ctx('match');
    const ruleId = await publishRule({
      name: `Risk ${unique('r')}`,
      context,
      priority: 10,
      ruleType: 'scoring',
      scoringSpec: riskSpec,
    });

    // 50×1 (amount > 100k) + 30×1 (consulting) + 20×0 = 80 ≥ 60
    const body = await evaluate(context, {
      amount: 500000,
      category: 'consulting',
      newVendor: false,
    });

    expect(body.matched).toBe(true);
    expect(body.matchedRuleId).toBe(ruleId);
    expect(body.ruleType).toBe('scoring');
    expect(body.evaluationTrace.type).toBe('scoring');

    const breakdown = body.evaluationTrace.scoreBreakdown;
    expect(breakdown).toMatchObject({ total: 80, threshold: 60, operator: '>=' });
    expect(breakdown.factors).toEqual([
      { field: 'amount', weight: 50, score: 1, contribution: 50, value: 500000 },
      { field: 'category', weight: 30, score: 1, contribution: 30, value: 'consulting' },
      { field: 'newVendor', weight: 20, score: 0, contribution: 0, value: false },
    ]);

    // The trace nodes mirror the factors plus the threshold check.
    expect(body.evaluationTrace.nodes.map((n: { nodePath: string }) => n.nodePath)).toEqual([
      'factors[0]',
      'factors[1]',
      'factors[2]',
      'root',
    ]);
  });

  it('does not match below the threshold and still explains the score', async () => {
    const context = ctx('nomatch');
    await publishRule({
      name: `Risk ${unique('r')}`,
      context,
      ruleType: 'scoring',
      scoringSpec: riskSpec,
    });

    // 50×0 + 30×0.2 + 20×0 = 6
    const body = await evaluate(context, { amount: 5000, category: 'travel', newVendor: false });
    expect(body.matched).toBe(false);
    expect(body.noMatch).toBe(true);
    expect(body.evaluationTrace).toBeNull(); // no winner ⇒ no winning trace
    expect(body.matchesConsidered[0]).toMatchObject({ ruleType: 'scoring', matched: false });
  });

  it('scores a missing field as 0 rather than failing the evaluation', async () => {
    const context = ctx('missing');
    await publishRule({
      name: `Risk ${unique('r')}`,
      context,
      ruleType: 'scoring',
      scoringSpec: riskSpec,
    });

    // amount missing (0) + consulting (30) + newVendor (20) = 50 < 60
    const body = await evaluate(context, { category: 'consulting', newVendor: true });
    expect(body.matched).toBe(false);
    expect(body.matchesConsidered[0].matched).toBe(false);

    // ...and with a bigger category weight it clears, proving the missing field never threw.
    const hit = await evaluate(context, { amount: 200000, category: 'consulting', newVendor: true });
    expect(hit.matched).toBe(true);
    expect(hit.evaluationTrace.scoreBreakdown.total).toBe(100);
  });

  it('a condition factor reuses the full operator catalog', async () => {
    const context = ctx('condition');
    await publishRule({
      name: `Weekend rush ${unique('r')}`,
      context,
      ruleType: 'scoring',
      scoringSpec: {
        threshold: 1,
        factors: [
          {
            label: 'rush order',
            weight: 1,
            scoringFunction: {
              type: 'condition',
              whenTrue: 1,
              whenFalse: 0,
              condition: { field: 'tags', operator: 'CONTAINS_ANY', value: ['rush', 'urgent'] },
            },
          },
        ],
      },
    });

    expect((await evaluate(context, { tags: ['urgent'] })).matched).toBe(true);
    expect((await evaluate(context, { tags: ['normal'] })).matched).toBe(false);
  });

  it('the field registry defaults and coerces for scoring factors too', async () => {
    const context = ctx('registry');
    const field = `score_amt_${Date.now()}`;
    await request(app.getHttpServer())
      .post('/api/v1/fields')
      .set(auth(admin.accessToken))
      .send({ name: field, type: 'number', defaultIfMissing: 100 })
      .expect(201);

    await publishRule({
      name: `Registry ${unique('r')}`,
      context,
      ruleType: 'scoring',
      scoringSpec: {
        threshold: 0.5,
        factors: [{ field, weight: 1, scoringFunction: { type: 'linear', min: 0, max: 200 } }],
      },
    });

    // Missing → defaultIfMissing 100 → score 0.5 → matches (>=).
    const defaulted = await evaluate(context, {});
    expect(defaulted.matched).toBe(true);
    expect(defaulted.evaluationTrace.scoreBreakdown.factors[0]).toMatchObject({
      value: 100,
      notes: ['default_applied'],
    });

    // A numeric string coerces because the field is registered numeric.
    const coerced = await evaluate(context, { [field]: '200' });
    expect(coerced.evaluationTrace.scoreBreakdown.total).toBe(1);
  });

  it('conflict resolution ranks scoring and condition rules together', async () => {
    const context = ctx('conflict');
    // Scoring rule: priority 5, 3 factors → most specific at that priority.
    const scoring = await publishRule({
      name: `Scoring ${unique('r')}`,
      context,
      priority: 5,
      ruleType: 'scoring',
      scoringSpec: { ...riskSpec, threshold: 1 },
    });
    // Condition rule: priority 5, 1 condition → loses on specificity.
    const tree = await publishRule({
      name: `Tree ${unique('r')}`,
      context,
      priority: 5,
      conditionAst: { field: 'amount', operator: '>', value: 1 },
    });

    const body = await evaluate(context, { amount: 500000, category: 'travel', newVendor: true });
    expect(body.matchedRuleId).toBe(scoring);
    expect(body.ruleType).toBe('scoring');
    expect(body.matchesConsidered.map((m: { ruleId: string }) => m.ruleId)).toEqual([scoring, tree]);
    expect(body.matchesConsidered.map((m: { conditionCount: number }) => m.conditionCount)).toEqual([
      3, 1,
    ]);
  });

  it('a scoring rule never counts as a context catch-all', async () => {
    const context = ctx('fallback');
    await publishRule({
      name: `Always scores ${unique('r')}`,
      context,
      ruleType: 'scoring',
      // threshold 0 with a >= comparison always matches, but it is not a catch-all AST
      scoringSpec: {
        threshold: 0,
        factors: [{ field: 'amount', weight: 0, scoringFunction: { type: 'linear', min: 0, max: 1 } }],
      },
    });

    const health = await request(app.getHttpServer())
      .get('/api/v1/rules/contexts/health')
      .set(auth(admin.accessToken))
      .expect(200);
    const entry = health.body.contexts.find((c: { context: string }) => c.context === context);
    expect(entry).toMatchObject({ publishedRules: 1, hasFallback: false });
  });

  it('editing a published scoring rule creates v2; the published version stays immutable', async () => {
    const context = ctx('version');
    const ruleId = await publishRule({
      name: `Versioned ${unique('r')}`,
      context,
      ruleType: 'scoring',
      scoringSpec: { ...riskSpec, threshold: 60 },
    });
    expect((await evaluate(context, { amount: 50000, category: 'travel' })).matched).toBe(false); // 31

    await request(app.getHttpServer())
      .put(`/api/v1/rules/${ruleId}/draft`)
      .set(auth(admin.accessToken))
      .send({ ruleType: 'scoring', scoringSpec: { ...riskSpec, threshold: 30 } })
      .expect(200);
    await request(app.getHttpServer())
      .post(`/api/v1/rules/${ruleId}/publish`)
      .set(auth(admin.accessToken))
      .expect(200);

    const after = await evaluate(context, { amount: 50000, category: 'travel' });
    expect(after.matched).toBe(true);
    expect(after.matchedRuleVersion).toBe(2);
    expect(after.evaluationTrace.scoreBreakdown.threshold).toBe(30);

    // v1 is still on record, unchanged.
    const versions = await request(app.getHttpServer())
      .get(`/api/v1/rules/${ruleId}/versions`)
      .set(auth(admin.accessToken))
      .expect(200);
    const v1 = versions.body.items.find((v: { version: number }) => v.version === 1);
    expect(v1.scoringSpec.threshold).toBe(60);
  });

  it('a rule can switch type across versions', async () => {
    const context = ctx('switch');
    const ruleId = await publishRule({
      name: `Switcher ${unique('r')}`,
      context,
      conditionAst: { field: 'amount', operator: '>', value: 1000000 },
    });

    await request(app.getHttpServer())
      .put(`/api/v1/rules/${ruleId}/draft`)
      .set(auth(admin.accessToken))
      .send({ ruleType: 'scoring', scoringSpec: { ...riskSpec, threshold: 20 } })
      .expect(200);
    await request(app.getHttpServer())
      .post(`/api/v1/rules/${ruleId}/publish`)
      .set(auth(admin.accessToken))
      .expect(200);

    const body = await evaluate(context, { amount: 50000, category: 'travel', newVendor: true });
    expect(body.matched).toBe(true);
    expect(body.ruleType).toBe('scoring');

    // The old condition_ast is gone, not left dangling beside the new spec.
    const reloaded = await request(app.getHttpServer())
      .get(`/api/v1/rules/${ruleId}`)
      .set(auth(admin.accessToken))
      .expect(200);
    expect(reloaded.body.latestVersion).toMatchObject({
      ruleType: 'scoring',
      conditionAst: null,
    });
  });
});
