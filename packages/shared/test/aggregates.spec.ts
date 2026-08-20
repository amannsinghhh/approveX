import { describe, expect, it } from 'vitest';
import {
  aggregateKey,
  aggregateOperandIssues,
  collectAggregateRefs,
  isAggregateOperator,
  windowLabel,
  windowStartMs,
  MAX_AGGREGATE_WINDOW_DAYS,
} from '../src/rule-evaluator/aggregates';
import { evaluateCondition } from '../src/rule-evaluator/evaluate';
import {
  isOperatorLegalForType,
  operatorsForType,
  OPERAND_SHAPE,
} from '../src/rule-evaluator/operators';
import type {
  AggregateOperand,
  ConditionNode,
  EvalContext,
  FieldSchema,
} from '../src/rule-evaluator/types';
import { validateConditionAst } from '../src/rule-evaluator/validate';

const rolling30: AggregateOperand = {
  window: { kind: 'rolling', days: 30 },
  compare: '>',
  threshold: 3,
};

const fySum: AggregateOperand = {
  window: { kind: 'fiscal_year_to_date' },
  compare: '>=',
  threshold: 500_000,
  sumField: 'amount',
};

const countNode = (operand: AggregateOperand = rolling30): ConditionNode => ({
  field: 'vendor_id',
  operator: 'AGGREGATE_COUNT_WITHIN',
  value: operand,
});

const sumNode = (operand: AggregateOperand = fySum): ConditionNode => ({
  field: 'requester_id',
  operator: 'AGGREGATE_SUM_WITHIN',
  value: operand,
});

describe('operator catalog', () => {
  it('offers aggregates on number and string fields, not boolean/date', () => {
    expect(operatorsForType('number')).toContain('AGGREGATE_COUNT_WITHIN');
    expect(operatorsForType('string')).toContain('AGGREGATE_SUM_WITHIN');
    expect(operatorsForType('boolean')).not.toContain('AGGREGATE_COUNT_WITHIN');
    expect(operatorsForType('date')).not.toContain('AGGREGATE_SUM_WITHIN');
    expect(operatorsForType(undefined)).toContain('AGGREGATE_COUNT_WITHIN');
  });

  it('legality follows the catalog', () => {
    expect(isOperatorLegalForType('AGGREGATE_COUNT_WITHIN', 'string')).toBe(true);
    expect(isOperatorLegalForType('AGGREGATE_SUM_WITHIN', 'boolean')).toBe(false);
  });

  it('declares the aggregate operand shape', () => {
    expect(OPERAND_SHAPE.AGGREGATE_COUNT_WITHIN).toBe('aggregate');
    expect(OPERAND_SHAPE.AGGREGATE_SUM_WITHIN).toBe('aggregate');
  });

  it('isAggregateOperator recognizes exactly the two operators', () => {
    expect(isAggregateOperator('AGGREGATE_COUNT_WITHIN')).toBe(true);
    expect(isAggregateOperator('AGGREGATE_SUM_WITHIN')).toBe(true);
    expect(isAggregateOperator('IN_LIST')).toBe(false);
  });
});

describe('operand validation', () => {
  it('accepts well-formed count and sum operands', () => {
    expect(validateConditionAst(countNode()).valid).toBe(true);
    expect(validateConditionAst(sumNode()).valid).toBe(true);
  });

  it('rejects a non-object operand', () => {
    const result = validateConditionAst({ ...countNode(), value: 30 });
    expect(result.valid).toBe(false);
    expect(result.issues[0]?.message).toMatch(/operand object/);
  });

  it.each([
    [{ ...rolling30, window: { kind: 'rolling', days: 0 } }, /integer days/],
    [{ ...rolling30, window: { kind: 'rolling', days: 2.5 } }, /integer days/],
    [
      { ...rolling30, window: { kind: 'rolling', days: MAX_AGGREGATE_WINDOW_DAYS + 1 } },
      /integer days/,
    ],
    [{ ...rolling30, window: { kind: 'quarterly' } }, /window\.kind/],
    [{ ...rolling30, window: undefined }, /window must be/],
    [{ ...rolling30, compare: '~' }, /compare must be one of/],
    [{ ...rolling30, threshold: 'many' }, /threshold must be a number/],
    [{ ...rolling30, sumField: 'amount' }, /only valid on AGGREGATE_SUM_WITHIN/],
  ] as [unknown, RegExp][])('rejects bad count operand %#', (operand, message) => {
    const result = validateConditionAst({ ...countNode(), value: operand });
    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.message).join('\n')).toMatch(message);
  });

  it('requires a valid sumField on SUM', () => {
    expect(aggregateOperandIssues('AGGREGATE_SUM_WITHIN', { ...fySum, sumField: undefined })).toEqual(
      ['AGGREGATE_SUM_WITHIN needs a valid sumField path (the history field to sum)'],
    );
    expect(
      aggregateOperandIssues('AGGREGATE_SUM_WITHIN', { ...fySum, sumField: '9bad path!' }),
    ).toHaveLength(1);
    expect(aggregateOperandIssues('AGGREGATE_SUM_WITHIN', fySum)).toEqual([]);
  });

  it('enforces operator/type legality for registered fields', () => {
    const schema: FieldSchema = { vendor_id: 'boolean' };
    const result = validateConditionAst(countNode(), schema);
    expect(result.valid).toBe(false);
    expect(result.issues[0]?.message).toMatch(/not valid for boolean/);
  });
});

describe('keys and windows', () => {
  it('labels windows canonically', () => {
    expect(windowLabel({ kind: 'rolling', days: 30 })).toBe('30d');
    expect(windowLabel({ kind: 'fiscal_year_to_date' })).toBe('fytd');
  });

  it('builds canonical count and sum keys', () => {
    expect(aggregateKey('AGGREGATE_COUNT_WITHIN', 'vendor_id', 'V42', rolling30)).toBe(
      'agg:count:30d:vendor_id=V42',
    );
    expect(aggregateKey('AGGREGATE_SUM_WITHIN', 'requester_id', 'U7', fySum)).toBe(
      'agg:sum:amount:fytd:requester_id=U7',
    );
    // Non-string group values are JSON-stringified deterministically.
    expect(aggregateKey('AGGREGATE_COUNT_WITHIN', 'dept_code', 4020, rolling30)).toBe(
      'agg:count:30d:dept_code=4020',
    );
  });
});

describe('evaluation', () => {
  const payload = { vendor_id: 'V42', requester_id: 'U7', amount: 120_000 };

  it('matches when the injected count crosses the threshold (scenario 17)', () => {
    const result = evaluateCondition(countNode(), payload, {
      aggregates: { 'agg:count:30d:vendor_id=V42': 4 },
    });
    expect(result.matched).toBe(true);
    expect(result.aggregatesUsed).toEqual([
      { type: 'count', groupBy: 'vendor_id', window: '30d', value: 4 },
    ]);
    // The trace shows the aggregate value, not the group key.
    expect(result.trace[0]?.actual).toBe(4);
  });

  it('does not match below the threshold', () => {
    const result = evaluateCondition(countNode(), payload, {
      aggregates: { 'agg:count:30d:vendor_id=V42': 3 },
    });
    expect(result.matched).toBe(false);
    expect(result.aggregatesUsed?.[0]?.value).toBe(3);
  });

  it('sums against a fiscal-year-to-date window (scenario 22)', () => {
    const result = evaluateCondition(sumNode(), payload, {
      aggregates: { 'agg:sum:amount:fytd:requester_id=U7': 612_000 },
    });
    expect(result.matched).toBe(true);
    expect(result.aggregatesUsed).toEqual([
      { type: 'sum', groupBy: 'requester_id', window: 'fytd', value: 612_000 },
    ]);
  });

  it('fails closed with missing_aggregate when the key was not injected', () => {
    const result = evaluateCondition(countNode(), payload, { aggregates: {} });
    expect(result.matched).toBe(false);
    expect(result.trace[0]?.notes).toContain('missing_aggregate');
    expect(result.aggregatesUsed).toBeUndefined();
  });

  it('fails closed when no aggregates were injected at all', () => {
    const result = evaluateCondition(countNode(), payload, {});
    expect(result.matched).toBe(false);
    expect(result.trace[0]?.notes).toContain('missing_aggregate');
  });

  it('fails with missing_field when the group field is absent', () => {
    const result = evaluateCondition(countNode(), { amount: 1 }, { aggregates: {} });
    expect(result.matched).toBe(false);
    expect(result.trace[0]?.notes).toContain('missing_field');
  });

  it('flags a malformed operand at runtime', () => {
    const bad: ConditionNode = { ...countNode(), value: { window: { kind: 'rolling' } } };
    const result = evaluateCondition(bad, payload, { aggregates: {} });
    expect(result.matched).toBe(false);
    expect(result.trace[0]?.notes).toContain('invalid_operand');
  });

  it('uses a declared defaultIfMissing as the group value', () => {
    const schema: FieldSchema = {
      vendor_id: { type: 'string', defaultIfMissing: 'UNKNOWN' },
    };
    const result = evaluateCondition(countNode(), {}, {
      fieldSchema: schema,
      aggregates: { 'agg:count:30d:vendor_id=UNKNOWN': 9 },
    });
    expect(result.matched).toBe(true);
    expect(result.trace[0]?.notes).toContain('default_applied');
  });

  it('fast path (collectTrace: false) agrees and still reports aggregatesUsed', () => {
    const options = { aggregates: { 'agg:count:30d:vendor_id=V42': 4 }, collectTrace: false };
    const result = evaluateCondition(countNode(), payload, options);
    expect(result.matched).toBe(true);
    expect(result.trace).toEqual([]);
    expect(result.aggregatesUsed).toEqual([
      { type: 'count', groupBy: 'vendor_id', window: '30d', value: 4 },
    ]);
  });

  it.each([
    ['>', 4, 3, true],
    ['>', 3, 3, false],
    ['>=', 3, 3, true],
    ['<', 2, 3, true],
    ['<=', 3, 3, true],
    ['=', 3, 3, true],
    ['!=', 4, 3, true],
    ['!=', 3, 3, false],
  ] as const)('compare %s: value %d vs threshold %d → %s', (compare, value, threshold, want) => {
    const node = countNode({ window: { kind: 'rolling', days: 30 }, compare, threshold });
    const result = evaluateCondition(node, payload, {
      aggregates: { 'agg:count:30d:vendor_id=V42': value },
    });
    expect(result.matched).toBe(want);
  });
});

describe('collectAggregateRefs', () => {
  const payload = { vendor_id: 'V42', requester_id: 'U7' };

  it('collects deduped refs across the tree', () => {
    const ast: ConditionNode = {
      operator: 'AND',
      children: [countNode(), sumNode(), countNode()],
    };
    const refs = collectAggregateRefs(ast, payload);
    expect(refs).toHaveLength(2);
    expect(refs.map((ref) => ref.key).sort()).toEqual([
      'agg:count:30d:vendor_id=V42',
      'agg:sum:amount:fytd:requester_id=U7',
    ]);
    const sum = refs.find((ref) => ref.kind === 'sum');
    expect(sum).toMatchObject({
      field: 'requester_id',
      groupValue: 'U7',
      sumField: 'amount',
      window: { kind: 'fiscal_year_to_date' },
    });
  });

  it('skips nodes whose group value is missing, unless a default applies', () => {
    expect(collectAggregateRefs(countNode(), {})).toEqual([]);
    const schema: FieldSchema = { vendor_id: { type: 'string', defaultIfMissing: 'UNKNOWN' } };
    const refs = collectAggregateRefs(countNode(), {}, schema);
    expect(refs.map((ref) => ref.key)).toEqual(['agg:count:30d:vendor_id=UNKNOWN']);
  });

  it('skips malformed operands and non-aggregate leaves', () => {
    const ast: ConditionNode = {
      operator: 'OR',
      children: [
        { field: 'amount', operator: '>', value: 5 },
        { ...countNode(), value: { window: { kind: 'weekly' } } },
      ],
    };
    expect(collectAggregateRefs(ast, payload)).toEqual([]);
  });
});

describe('windowStartMs (test scenario 22)', () => {
  const IST_OFFSET_MS = 5.5 * 3_600_000; // Asia/Kolkata, fixed offset
  const juneNow = Date.UTC(2026, 5, 15, 12, 0); // 2026-06-15 17:30 IST
  const febNow = Date.UTC(2026, 1, 10, 12, 0); // 2026-02-10 17:30 IST

  it('rolling windows reach back N days from context.now', () => {
    const ctx: EvalContext = { now: juneNow };
    expect(windowStartMs({ kind: 'rolling', days: 30 }, ctx)).toBe(juneNow - 30 * 86_400_000);
  });

  it('fiscal YTD after April 1 starts at April 1 of the same year (tenant tz)', () => {
    const ctx: EvalContext = { now: juneNow };
    expect(windowStartMs({ kind: 'fiscal_year_to_date' }, ctx)).toBe(
      Date.UTC(2026, 3, 1) - IST_OFFSET_MS,
    );
  });

  it('fiscal YTD before April 1 starts at April 1 of the previous year', () => {
    const ctx: EvalContext = { now: febNow };
    expect(windowStartMs({ kind: 'fiscal_year_to_date' }, ctx)).toBe(
      Date.UTC(2025, 3, 1) - IST_OFFSET_MS,
    );
  });

  it('honours tenant fiscalYearStartMonth and timezone overrides', () => {
    const ctx: EvalContext = { now: febNow, timezone: 'UTC', fiscalYearStartMonth: 1 };
    expect(windowStartMs({ kind: 'fiscal_year_to_date' }, ctx)).toBe(Date.UTC(2026, 0, 1));
  });
});
