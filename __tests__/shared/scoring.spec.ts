import { describe, expect, it } from 'vitest';
import {
  countScoringFactors,
  evaluateScoring,
  MAX_SCORING_FACTORS,
  validateScoringSpec,
} from '../../shared/src/rule-evaluator/scoring';
import type { ScoringFactor, ScoringSpec } from '../../shared/src/rule-evaluator/scoring';
import type { EvaluateOptions, FieldSchema } from '../../shared/src/rule-evaluator/types';

const spec = (factors: ScoringFactor[], threshold: number, operator?: ScoringSpec['operator']) =>
  ({ factors, threshold, ...(operator ? { operator } : {}) }) as ScoringSpec;

const run = (s: ScoringSpec, data: unknown, options?: EvaluateOptions) =>
  evaluateScoring(s, data, options);

/** A realistic expense-risk spec: amount tiers + category map + a boolean flag. */
const riskSpec: ScoringSpec = {
  threshold: 60,
  factors: [
    {
      field: 'amount',
      weight: 50,
      scoringFunction: {
        type: 'bands',
        bands: [{ upTo: 10_000, score: 0 }, { upTo: 100_000, score: 0.5 }, { score: 1 }],
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

describe('evaluateScoring — totals and thresholds', () => {
  it('sums weight × score and matches when the total clears the threshold', () => {
    // 50×1 + 30×1 + 20×0 = 80 ≥ 60
    const result = run(riskSpec, { amount: 500_000, category: 'consulting', newVendor: false });
    expect(result.matched).toBe(true);
    expect(result.scoreBreakdown?.total).toBe(80);
    expect(result.scoreBreakdown?.threshold).toBe(60);
    expect(result.scoreBreakdown?.operator).toBe('>=');
  });

  it('does not match below the threshold', () => {
    // 50×0 + 30×0.2 + 20×0 = 6
    const result = run(riskSpec, { amount: 5_000, category: 'travel', newVendor: false });
    expect(result.matched).toBe(false);
    expect(result.scoreBreakdown?.total).toBe(6);
  });

  it('treats the threshold as inclusive for >= and exclusive for >', () => {
    const factors: ScoringFactor[] = [
      { field: 'n', weight: 10, scoringFunction: { type: 'linear', min: 0, max: 10 } },
    ];
    expect(run(spec(factors, 5), { n: 5 }).matched).toBe(true);
    expect(run(spec(factors, 5, '>'), { n: 5 }).matched).toBe(false);
    expect(run(spec(factors, 5, '>'), { n: 6 }).matched).toBe(true);
  });

  it('supports below-threshold rules with < and <=', () => {
    const factors: ScoringFactor[] = [
      { field: 'n', weight: 1, scoringFunction: { type: 'linear', min: 0, max: 100 } },
    ];
    expect(run(spec(factors, 0.5, '<'), { n: 20 }).matched).toBe(true);
    expect(run(spec(factors, 0.2, '<='), { n: 20 }).matched).toBe(true);
    expect(run(spec(factors, 0.2, '<'), { n: 20 }).matched).toBe(false);
  });

  it('lets negative weights mitigate the total', () => {
    const factors: ScoringFactor[] = [
      { field: 'amount', weight: 100, scoringFunction: { type: 'linear', min: 0, max: 1000 } },
      { field: 'trusted', weight: -60, scoringFunction: { type: 'boolean', whenTrue: 1, whenFalse: 0 } },
    ];
    expect(run(spec(factors, 50), { amount: 1000, trusted: false }).matched).toBe(true);
    const mitigated = run(spec(factors, 50), { amount: 1000, trusted: true });
    expect(mitigated.matched).toBe(false);
    expect(mitigated.scoreBreakdown?.total).toBe(40);
  });

  it('rounds away float noise so a total lands exactly on its threshold', () => {
    const factors: ScoringFactor[] = [
      { field: 'a', weight: 0.1, scoringFunction: { type: 'boolean', whenTrue: 1, whenFalse: 0 } },
      { field: 'b', weight: 0.2, scoringFunction: { type: 'boolean', whenTrue: 1, whenFalse: 0 } },
    ];
    // 0.1 + 0.2 = 0.30000000000000004 in raw IEEE 754.
    const result = run(spec(factors, 0.3), { a: true, b: true });
    expect(result.scoreBreakdown?.total).toBe(0.3);
    expect(result.matched).toBe(true);
  });
});

describe('evaluateScoring — scoring functions', () => {
  it('linear normalizes onto 0..1 and clamps outside the range by default', () => {
    const factors: ScoringFactor[] = [
      { field: 'n', weight: 1, scoringFunction: { type: 'linear', min: 100, max: 200 } },
    ];
    const score = (n: number) => run(spec(factors, 999), { n }).scoreBreakdown?.factors[0]?.score;
    expect(score(150)).toBe(0.5);
    expect(score(50)).toBe(0);
    expect(score(500)).toBe(1);
  });

  it('linear with clamp:false runs outside 0..1', () => {
    const factors: ScoringFactor[] = [
      { field: 'n', weight: 1, scoringFunction: { type: 'linear', min: 0, max: 100, clamp: false } },
    ];
    expect(run(spec(factors, 999), { n: 250 }).scoreBreakdown?.factors[0]?.score).toBe(2.5);
    expect(run(spec(factors, 999), { n: -50 }).scoreBreakdown?.factors[0]?.score).toBe(-0.5);
  });

  it('bands pick the first band whose inclusive upTo covers the value', () => {
    const factors: ScoringFactor[] = [
      {
        field: 'n',
        weight: 1,
        scoringFunction: {
          type: 'bands',
          bands: [{ upTo: 10, score: 0.1 }, { upTo: 20, score: 0.5 }, { score: 1 }],
        },
      },
    ];
    const score = (n: number) => run(spec(factors, 999), { n }).scoreBreakdown?.factors[0]?.score;
    expect(score(10)).toBe(0.1); // upper bound is inclusive
    expect(score(11)).toBe(0.5);
    expect(score(20)).toBe(0.5);
    expect(score(21)).toBe(1); // the open-ended catch-all
    expect(score(-5)).toBe(0.1);
  });

  it('map looks up exact values, falls back to default, and notes an unmapped value', () => {
    const factors: ScoringFactor[] = [
      { field: 'tier', weight: 1, scoringFunction: { type: 'map', values: { gold: 1 }, default: 0.25 } },
    ];
    expect(run(spec(factors, 999), { tier: 'gold' }).scoreBreakdown?.factors[0]?.score).toBe(1);
    expect(run(spec(factors, 999), { tier: 'bronze' }).scoreBreakdown?.factors[0]?.score).toBe(0.25);

    const noDefault: ScoringFactor[] = [
      { field: 'tier', weight: 1, scoringFunction: { type: 'map', values: { gold: 1 } } },
    ];
    const unmapped = run(spec(noDefault, 999), { tier: 'bronze' }).scoreBreakdown?.factors[0];
    expect(unmapped?.score).toBe(0);
    expect(unmapped?.notes).toEqual(['unmapped_value']);
  });

  it('map keys numbers and booleans by their string form', () => {
    const factors: ScoringFactor[] = [
      { field: 'level', weight: 1, scoringFunction: { type: 'map', values: { '3': 0.75 } } },
    ];
    expect(run(spec(factors, 999), { level: 3 }).scoreBreakdown?.factors[0]?.score).toBe(0.75);
  });

  it('map ignores inherited Object.prototype keys', () => {
    const factors: ScoringFactor[] = [
      { field: 'tier', weight: 1, scoringFunction: { type: 'map', values: { gold: 1 }, default: 0.5 } },
    ];
    // "constructor" must hit the default, not Object.prototype.constructor.
    expect(run(spec(factors, 999), { tier: 'constructor' }).scoreBreakdown?.factors[0]?.score).toBe(0.5);
  });

  it('coerces numeric strings ONLY for registered number fields (mirrors condition evaluator)', () => {
    const factors: ScoringFactor[] = [
      {
        field: 'amount',
        weight: 1,
        scoringFunction: { type: 'bands', bands: [{ upTo: 100, score: 0 }, { score: 1 }] },
      },
    ];
    // Unregistered field + numeric string: no silent coercion — type_mismatch fallback.
    const strict = run(spec(factors, 1), { amount: '250' }).scoreBreakdown?.factors[0];
    expect(strict?.score).toBe(0);
    expect(strict?.notes).toEqual(['type_mismatch']);

    // Registered as number: the string coerces, exactly like coercePair in conditions.
    const fieldSchema: FieldSchema = { amount: { type: 'number' } };
    const coerced = run(spec(factors, 1), { amount: '250' }, { fieldSchema });
    expect(coerced.scoreBreakdown?.factors[0]?.score).toBe(1);
    expect(coerced.matched).toBe(true);

    // Same contract for linear.
    const linear: ScoringFactor[] = [
      { field: 'amount', weight: 1, scoringFunction: { type: 'linear', min: 0, max: 100 } },
    ];
    const linearStrict = run(spec(linear, 999), { amount: '50' }).scoreBreakdown?.factors[0];
    expect(linearStrict?.score).toBe(0);
    expect(linearStrict?.notes).toEqual(['type_mismatch']);
    expect(
      run(spec(linear, 999), { amount: '50' }, { fieldSchema }).scoreBreakdown?.factors[0]?.score,
    ).toBe(0.5);
  });

  it('boolean scores whenTrue / whenFalse and type-mismatches on non-booleans', () => {
    const factors: ScoringFactor[] = [
      { field: 'flag', weight: 1, scoringFunction: { type: 'boolean', whenTrue: 1, whenFalse: 0.2 } },
    ];
    expect(run(spec(factors, 999), { flag: true }).scoreBreakdown?.factors[0]?.score).toBe(1);
    expect(run(spec(factors, 999), { flag: false }).scoreBreakdown?.factors[0]?.score).toBe(0.2);
    const mismatch = run(spec(factors, 999), { flag: 'yes' }).scoreBreakdown?.factors[0];
    expect(mismatch?.score).toBe(0);
    expect(mismatch?.notes).toEqual(['type_mismatch']);
  });

  it('condition factors score a full condition AST and carry no field of their own', () => {
    const factors: ScoringFactor[] = [
      {
        label: 'rush order outside business hours',
        weight: 40,
        scoringFunction: {
          type: 'condition',
          whenTrue: 1,
          whenFalse: 0,
          condition: {
            operator: 'AND',
            children: [
              { field: 'amount', operator: '>', value: 1000 },
              { field: 'tags', operator: 'CONTAINS', value: 'rush' },
            ],
          },
        },
      },
    ];
    const hit = run(spec(factors, 40), { amount: 5000, tags: ['rush', 'intl'] });
    expect(hit.matched).toBe(true);
    expect(hit.scoreBreakdown?.factors[0]?.field).toBe('rush order outside business hours');
    expect(hit.scoreBreakdown?.factors[0]?.value).toBe(true);

    const miss = run(spec(factors, 40), { amount: 5000, tags: ['normal'] });
    expect(miss.matched).toBe(false);
    expect(miss.scoreBreakdown?.total).toBe(0);
  });

  it('condition factors see the evaluator options (field schema, eval context)', () => {
    const fieldSchema: FieldSchema = { amount: { type: 'number' } };
    const factors: ScoringFactor[] = [
      {
        label: 'big',
        weight: 1,
        scoringFunction: {
          type: 'condition',
          whenTrue: 1,
          whenFalse: 0,
          // "500" coerces because amount is a registered number field.
          condition: { field: 'amount', operator: '>', value: 500 },
        },
      },
    ];
    expect(run(spec(factors, 1), { amount: '900' }, { fieldSchema }).matched).toBe(true);
  });
});

describe('evaluateScoring — missing and defaulted fields', () => {
  it('scores a missing field as 0 and notes it, never throwing', () => {
    const result = run(riskSpec, { category: 'travel', newVendor: true });
    const amount = result.scoreBreakdown?.factors[0];
    expect(amount?.score).toBe(0);
    expect(amount?.contribution).toBe(0);
    expect(amount?.notes).toEqual(['missing_field']);
    expect(result.scoreBreakdown?.total).toBe(26); // 0 + 30×0.2 + 20×1
  });

  it('honours an explicit missingScore', () => {
    const factors: ScoringFactor[] = [
      {
        field: 'amount',
        weight: 100,
        missingScore: 1, // unknown amount is maximally risky
        scoringFunction: { type: 'linear', min: 0, max: 1000 },
      },
    ];
    const result = run(spec(factors, 100), {});
    expect(result.matched).toBe(true);
    expect(result.scoreBreakdown?.factors[0]?.notes).toEqual(['missing_field']);
  });

  it('substitutes the registry defaultIfMissing before scoring', () => {
    const fieldSchema: FieldSchema = { amount: { type: 'number', defaultIfMissing: 500 } };
    const factors: ScoringFactor[] = [
      { field: 'amount', weight: 1, scoringFunction: { type: 'linear', min: 0, max: 1000 } },
    ];
    const factor = run(spec(factors, 999), {}, { fieldSchema }).scoreBreakdown?.factors[0];
    expect(factor?.score).toBe(0.5);
    expect(factor?.value).toBe(500);
    expect(factor?.notes).toEqual(['default_applied']);
  });

  it('treats an explicit null like a missing field', () => {
    const factors: ScoringFactor[] = [
      { field: 'n', weight: 1, scoringFunction: { type: 'linear', min: 0, max: 10 } },
    ];
    expect(run(spec(factors, 999), { n: null }).scoreBreakdown?.factors[0]?.notes).toEqual([
      'missing_field',
    ]);
  });

  it('resolves dotted paths', () => {
    const factors: ScoringFactor[] = [
      { field: 'vendor.riskTier', weight: 1, scoringFunction: { type: 'map', values: { high: 1 } } },
    ];
    expect(run(spec(factors, 1), { vendor: { riskTier: 'high' } }).matched).toBe(true);
  });
});

describe('evaluateScoring — trace', () => {
  it('emits one node per factor plus the threshold node', () => {
    const result = run(riskSpec, { amount: 500_000, category: 'consulting', newVendor: true });
    expect(result.trace.map((node) => node.nodePath)).toEqual([
      'factors[0]',
      'factors[1]',
      'factors[2]',
      'root',
    ]);
    expect(result.trace[0]?.operator).toBe('SCORE_BANDS');
    expect(result.trace[1]?.operator).toBe('SCORE_MAP');
    expect(result.trace[2]?.operator).toBe('SCORE_BOOLEAN');

    const root = result.trace[3];
    expect(root?.operator).toBe('SCORE >=');
    expect(root?.expected).toBe(60);
    expect(root?.actual).toBe(100);
    expect(root?.result).toBe(true);
  });

  it('marks a factor node ✗ when it could not be scored', () => {
    const result = run(riskSpec, { category: 'travel', newVendor: false });
    expect(result.trace[0]?.result).toBe(false); // amount missing
    expect(result.trace[1]?.result).toBe(true);
  });

  it('reports every factor value, weight, score and contribution', () => {
    const factors = run(riskSpec, { amount: 50_000, category: 'travel', newVendor: true })
      .scoreBreakdown?.factors;
    expect(factors).toEqual([
      { field: 'amount', weight: 50, score: 0.5, contribution: 25, value: 50_000, notes: undefined },
      { field: 'category', weight: 30, score: 0.2, contribution: 6, value: 'travel', notes: undefined },
      { field: 'newVendor', weight: 20, score: 1, contribution: 20, value: true, notes: undefined },
    ]);
  });

  it('collectTrace:false returns the same verdict with no trace or breakdown', () => {
    const data = { amount: 500_000, category: 'consulting', newVendor: false };
    const traced = run(riskSpec, data);
    const fast = run(riskSpec, data, { collectTrace: false });
    expect(fast.matched).toBe(traced.matched);
    expect(fast.trace).toEqual([]);
    expect(fast.scoreBreakdown).toBeUndefined();
  });
});

describe('countScoringFactors', () => {
  it('counts factors — the specificity measure for conflict resolution', () => {
    expect(countScoringFactors(riskSpec)).toBe(3);
  });
});

describe('validateScoringSpec', () => {
  const valid = (s: unknown, fieldSchema?: FieldSchema) =>
    validateScoringSpec(s, fieldSchema).valid;
  const issues = (s: unknown, fieldSchema?: FieldSchema) =>
    validateScoringSpec(s, fieldSchema).issues.map((i) => i.message);

  it('accepts the realistic spec', () => {
    expect(valid(riskSpec)).toBe(true);
  });

  it('rejects non-objects and missing thresholds', () => {
    expect(valid(null)).toBe(false);
    expect(valid([])).toBe(false);
    expect(issues({ factors: riskSpec.factors })).toContain(
      'Scoring spec requires a numeric threshold',
    );
  });

  it('rejects an empty or oversized factor list', () => {
    expect(issues({ threshold: 1, factors: [] })).toContain(
      'Scoring spec requires a non-empty factors array',
    );
    const many = Array.from({ length: MAX_SCORING_FACTORS + 1 }, () => riskSpec.factors[0]!);
    expect(issues({ threshold: 1, factors: many })).toContain(
      `Scoring spec exceeds the maximum of ${MAX_SCORING_FACTORS} factors`,
    );
  });

  it('rejects an unknown operator or scoring function', () => {
    expect(issues({ ...riskSpec, operator: '~=' })).toContain('operator must be one of >=, >, <=, <');
    expect(
      issues({ threshold: 1, factors: [{ field: 'a', weight: 1, scoringFunction: { type: 'magic' } }] }),
    ).toContain('Unknown scoring function "magic"');
  });

  it('requires a numeric weight and a valid field path', () => {
    expect(
      issues({ threshold: 1, factors: [{ weight: 'heavy', field: 'a', scoringFunction: { type: 'boolean', whenTrue: 1, whenFalse: 0 } }] }),
    ).toContain('Factor requires a numeric weight');
    expect(
      issues({ threshold: 1, factors: [{ weight: 1, field: '9bad', scoringFunction: { type: 'boolean', whenTrue: 1, whenFalse: 0 } }] }),
    ).toContain('A boolean factor requires a valid field path');
  });

  it('rejects a linear function with a zero span', () => {
    expect(
      issues({ threshold: 1, factors: [{ field: 'n', weight: 1, scoringFunction: { type: 'linear', min: 5, max: 5 } }] }),
    ).toContain('linear requires min ≠ max');
  });

  it('requires bands to ascend and to end with an open catch-all', () => {
    const bands = (b: unknown) => ({
      threshold: 1,
      factors: [{ field: 'n', weight: 1, scoringFunction: { type: 'bands', bands: b } }],
    });
    expect(issues(bands([{ upTo: 10, score: 0 }, { upTo: 5, score: 1 }, { score: 2 }]))).toContain(
      'band upTo values must ascend',
    );
    expect(issues(bands([{ upTo: 10, score: 0 }, { upTo: 20, score: 1 }]))).toContain(
      'the last band must omit upTo (catch-all)',
    );
    expect(valid(bands([{ score: 1 }]))).toBe(true);
  });

  it('rejects a condition factor that also names a field', () => {
    expect(
      issues({
        threshold: 1,
        factors: [
          {
            field: 'amount',
            weight: 1,
            scoringFunction: {
              type: 'condition',
              whenTrue: 1,
              whenFalse: 0,
              condition: { field: 'amount', operator: '>', value: 1 },
            },
          },
        ],
      }),
    ).toContain('A condition factor scores its own condition — remove "field"');
  });

  it('validates the nested condition AST of a condition factor', () => {
    const result = validateScoringSpec({
      threshold: 1,
      factors: [
        {
          weight: 1,
          scoringFunction: {
            type: 'condition',
            whenTrue: 1,
            whenFalse: 0,
            condition: { field: 'amount', operator: 'NOPE', value: 1 },
          },
        },
      ],
    });
    expect(result.valid).toBe(false);
    expect(result.issues[0]?.path).toBe('factors[0].condition');
    expect(result.issues[0]?.message).toContain('Unknown operator');
  });

  it('checks each function against the registered field type', () => {
    const fieldSchema: FieldSchema = {
      name: { type: 'string' },
      amount: { type: 'number' },
      flag: { type: 'boolean' },
    };
    const factor = (field: string, scoringFunction: unknown) => ({
      threshold: 1,
      factors: [{ field, weight: 1, scoringFunction }],
    });
    expect(issues(factor('name', { type: 'linear', min: 0, max: 1 }), fieldSchema)).toContain(
      'A linear function is not valid for a string field',
    );
    expect(
      issues(factor('amount', { type: 'boolean', whenTrue: 1, whenFalse: 0 }), fieldSchema),
    ).toContain('A boolean function is not valid for a number field');
    expect(valid(factor('flag', { type: 'boolean', whenTrue: 1, whenFalse: 0 }), fieldSchema)).toBe(
      true,
    );
    expect(valid(factor('amount', { type: 'bands', bands: [{ score: 1 }] }), fieldSchema)).toBe(true);
  });

  it('leaves unregistered fields alone', () => {
    expect(
      valid({ threshold: 1, factors: [{ field: 'unknown', weight: 1, scoringFunction: { type: 'linear', min: 0, max: 1 } }] }, { other: { type: 'string' } }),
    ).toBe(true);
  });
});
