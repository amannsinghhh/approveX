import { describe, expect, it } from 'vitest';
import { evaluateCondition } from '../src/rule-evaluator/evaluate';
import type {
  ComparisonOperator,
  ConditionNode,
  FieldSchema,
} from '../src/rule-evaluator/types';

const cmp = (field: string, operator: ComparisonOperator, value?: unknown): ConditionNode => ({
  field,
  operator,
  value,
});

/** Registry declaring `vendor_risk_score` as a looked_up numeric field. */
const schema: FieldSchema = {
  vendor_risk_score: { type: 'number', source: 'looked_up' },
  amount: { type: 'number', source: 'payload' },
};

describe('looked_up fields (B.3 #10)', () => {
  it('resolves the value from options.lookups and notes lookup_applied', () => {
    const result = evaluateCondition(
      cmp('vendor_risk_score', '>', 70),
      {},
      { fieldSchema: schema, lookups: { vendor_risk_score: 85 } },
    );
    expect(result.matched).toBe(true);
    expect(result.trace[0]?.notes).toContain('lookup_applied');
    expect(result.trace[0]?.actual).toBe(85);
    expect(result.lookupsUsed).toEqual([
      { field: 'vendor_risk_score', resolved: true, value: 85 },
    ]);
  });

  it('never reads the payload for a looked_up field — the injected value wins', () => {
    const result = evaluateCondition(
      cmp('vendor_risk_score', '>', 70),
      { vendor_risk_score: 99 }, // conflicting payload value must be ignored
      { fieldSchema: schema, lookups: { vendor_risk_score: 10 } },
    );
    expect(result.matched).toBe(false);
    expect(result.trace[0]?.actual).toBe(10);
  });

  it('fails closed with missing_lookup when the key is absent', () => {
    const result = evaluateCondition(
      cmp('vendor_risk_score', '>', 70),
      { vendor_risk_score: 99 },
      { fieldSchema: schema, lookups: {} },
    );
    expect(result.matched).toBe(false);
    expect(result.trace[0]?.notes).toContain('missing_lookup');
    expect(result.lookupsUsed).toEqual([{ field: 'vendor_risk_score', resolved: false }]);
  });

  it('fails closed when options.lookups is entirely absent', () => {
    const result = evaluateCondition(cmp('vendor_risk_score', '>', 70), {}, {
      fieldSchema: schema,
    });
    expect(result.matched).toBe(false);
    expect(result.trace[0]?.notes).toContain('missing_lookup');
  });

  it('a missing lookup is false even for negated operators (never a silent pass)', () => {
    const result = evaluateCondition(
      cmp('vendor_risk_score', '!=', 70),
      {},
      { fieldSchema: schema },
    );
    expect(result.matched).toBe(false);
    expect(result.trace[0]?.notes).toContain('missing_lookup');
  });

  it('accepts an explicitly null injected value (resolved, then normal null semantics)', () => {
    const result = evaluateCondition(
      cmp('vendor_risk_score', 'IS_NULL'),
      {},
      { fieldSchema: schema, lookups: { vendor_risk_score: null } },
    );
    expect(result.matched).toBe(true);
    expect(result.lookupsUsed).toEqual([
      { field: 'vendor_risk_score', resolved: true, value: null },
    ]);
  });

  it('records a looked_up field once even when referenced by multiple leaves', () => {
    const node: ConditionNode = {
      operator: 'AND',
      children: [cmp('vendor_risk_score', '>', 10), cmp('vendor_risk_score', '<', 90)],
    };
    const result = evaluateCondition(node, {}, {
      fieldSchema: schema,
      lookups: { vendor_risk_score: 50 },
    });
    expect(result.matched).toBe(true);
    expect(result.lookupsUsed).toHaveLength(1);
  });

  it('payload-sourced fields are untouched by options.lookups', () => {
    const result = evaluateCondition(
      cmp('amount', '>', 100),
      { amount: 500 },
      { fieldSchema: schema, lookups: { amount: 1 } },
    );
    expect(result.matched).toBe(true);
    expect(result.lookupsUsed).toBeUndefined();
  });

  it('fast path (collectTrace: false) matches and reports lookupsUsed identically', () => {
    const options = { fieldSchema: schema, lookups: { vendor_risk_score: 85 } };
    const fast = evaluateCondition(cmp('vendor_risk_score', '>', 70), {}, {
      ...options,
      collectTrace: false,
    });
    expect(fast.matched).toBe(true);
    expect(fast.trace).toEqual([]);
    expect(fast.lookupsUsed).toEqual([
      { field: 'vendor_risk_score', resolved: true, value: 85 },
    ]);

    const missing = evaluateCondition(cmp('vendor_risk_score', '>', 70), {}, {
      fieldSchema: schema,
      collectTrace: false,
    });
    expect(missing.matched).toBe(false);
    expect(missing.lookupsUsed).toEqual([{ field: 'vendor_risk_score', resolved: false }]);
  });
});
