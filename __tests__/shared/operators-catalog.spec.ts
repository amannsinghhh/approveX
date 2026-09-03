import { describe, expect, it } from 'vitest';
import { evaluateCondition } from '../../shared/src/rule-evaluator/evaluate';
import { operatorsForType, isOperatorLegalForType } from '../../shared/src/rule-evaluator/operators';
import {
  catchAllAst,
  countComparisons,
  isCatchAllAst,
  validateConditionAst,
} from '../../shared/src/rule-evaluator/validate';
import type {
  ComparisonOperator,
  ConditionNode,
  EvaluateOptions,
  FieldSchema,
  TraceNote,
} from '../../shared/src/rule-evaluator/types';

const cmp = (
  field: string,
  operator: ComparisonOperator,
  value?: unknown,
  valueType?: 'literal' | 'field',
): ConditionNode => ({ field, operator, value, valueType });

const run = (node: ConditionNode, data: unknown, options?: EvaluateOptions): boolean =>
  evaluateCondition(node, data, options).matched;

const notesOf = (node: ConditionNode, data: unknown, options?: EvaluateOptions): TraceNote[] =>
  evaluateCondition(node, data, options).trace[0]?.notes ?? [];

// Asia/Kolkata is UTC+5:30 with no DST — deterministic for tz assertions.
const IST: EvaluateOptions = { context: { timezone: 'Asia/Kolkata' } };

describe('numeric operators', () => {
  it('NOT_BETWEEN is the inverse of BETWEEN', () => {
    expect(run(cmp('n', 'BETWEEN', [10, 20]), { n: 15 })).toBe(true);
    expect(run(cmp('n', 'NOT_BETWEEN', [10, 20]), { n: 15 })).toBe(false);
    expect(run(cmp('n', 'NOT_BETWEEN', [10, 20]), { n: 25 })).toBe(true);
  });

  it('MULTIPLE_OF', () => {
    expect(run(cmp('d', 'MULTIPLE_OF', 5), { d: 25 })).toBe(true);
    expect(run(cmp('d', 'MULTIPLE_OF', 5), { d: 23 })).toBe(false);
    expect(notesOf(cmp('d', 'MULTIPLE_OF', 0), { d: 10 })).toContain('invalid_operand');
  });

  it('WITHIN_PERCENT_OF another field (proximity: invoice within 10% of the PO)', () => {
    const node = cmp('invoice', 'WITHIN_PERCENT_OF', { percent: 10, of: 'po' });
    expect(run(node, { invoice: 950, po: 1000 })).toBe(true); // off by 5% ≤ 10%
    expect(run(node, { invoice: 800, po: 1000 })).toBe(false); // off by 20% > 10%
    expect(notesOf(node, { invoice: 950 })).toContain('cross_field_missing');
  });
});

describe('text operators', () => {
  it('NOT_CONTAINS', () => {
    expect(run(cmp('s', 'NOT_CONTAINS', 'ab'), { s: 'xyz' })).toBe(true);
    expect(run(cmp('s', 'NOT_CONTAINS', 'ab'), { s: 'xaby' })).toBe(false);
  });

  it('IS_EMPTY / IS_NOT_EMPTY treat missing as empty', () => {
    expect(run(cmp('s', 'IS_EMPTY'), { s: '' })).toBe(true);
    expect(run(cmp('s', 'IS_EMPTY'), { s: 'x' })).toBe(false);
    expect(run(cmp('s', 'IS_EMPTY'), {})).toBe(true);
    expect(run(cmp('s', 'IS_NOT_EMPTY'), { s: 'x' })).toBe(true);
    expect(run(cmp('s', 'IS_NOT_EMPTY'), {})).toBe(false);
    expect(run(cmp('a', 'IS_EMPTY'), { a: [] })).toBe(true);
  });

  it('EQUALS_IGNORE_CASE / IN_IGNORE_CASE (source-system casing drift)', () => {
    expect(run(cmp('dept', 'EQUALS_IGNORE_CASE', 'Finance'), { dept: 'finance' })).toBe(true);
    expect(run(cmp('dept', 'IN_IGNORE_CASE', ['Finance', 'Legal']), { dept: 'FINANCE' })).toBe(true);
    expect(run(cmp('dept', 'IN_IGNORE_CASE', ['Finance']), { dept: 'ops' })).toBe(false);
  });
});

describe('date & time operators (tenant timezone)', () => {
  it('BEFORE / AFTER', () => {
    const node = cmp('d', 'BEFORE', '2026-07-08T00:00:00Z');
    expect(run(node, { d: '2026-07-01T00:00:00Z' })).toBe(true);
    expect(run(cmp('d', 'AFTER', '2026-07-08T00:00:00Z'), { d: '2026-07-10T00:00:00Z' })).toBe(true);
  });

  it('ON is same-calendar-day in the tenant timezone', () => {
    // 2026-07-08T20:00Z = 2026-07-09 01:30 IST
    expect(run(cmp('d', 'ON', '2026-07-09'), { d: '2026-07-08T20:00:00Z' }, IST)).toBe(true);
    expect(run(cmp('d', 'ON', '2026-07-08'), { d: '2026-07-08T20:00:00Z' }, IST)).toBe(false);
  });

  it('WITHIN_LAST / WITHIN_NEXT / OLDER_THAN N days', () => {
    const now = Date.parse('2026-07-08T12:00:00Z');
    const opts: EvaluateOptions = { context: { now } };
    const daysAgo = (n: number): string => new Date(now - n * 86_400_000).toISOString();
    expect(run(cmp('d', 'WITHIN_LAST_N_DAYS', 3), { d: daysAgo(2) }, opts)).toBe(true);
    expect(run(cmp('d', 'WITHIN_LAST_N_DAYS', 1), { d: daysAgo(2) }, opts)).toBe(false);
    expect(run(cmp('d', 'OLDER_THAN_N_DAYS', 1), { d: daysAgo(2) }, opts)).toBe(true);
    expect(run(cmp('d', 'WITHIN_NEXT_N_DAYS', 5), { d: daysAgo(-3) }, opts)).toBe(true);
  });

  it('DAY_OF_WEEK_IN (2026-07-08 is a Wednesday)', () => {
    const d = { d: '2026-07-08T12:00:00Z' };
    expect(run(cmp('d', 'DAY_OF_WEEK_IN', ['WED']), d, IST)).toBe(true);
    expect(run(cmp('d', 'DAY_OF_WEEK_IN', [3]), d, IST)).toBe(true);
    expect(run(cmp('d', 'DAY_OF_WEEK_IN', ['SAT', 'SUN']), d, IST)).toBe(false);
  });

  it('TIME_OF_DAY_BETWEEN handles normal and overnight windows', () => {
    // 12:00Z = 17:30 IST
    expect(run(cmp('d', 'TIME_OF_DAY_BETWEEN', ['09:00', '18:00']), { d: '2026-07-08T12:00:00Z' }, IST)).toBe(true);
    // 17:30Z = 23:00 IST → inside the overnight 22:00→06:00 window
    expect(run(cmp('d', 'TIME_OF_DAY_BETWEEN', ['22:00', '06:00']), { d: '2026-07-08T17:30:00Z' }, IST)).toBe(true);
    expect(run(cmp('d', 'TIME_OF_DAY_BETWEEN', ['22:00', '06:00']), { d: '2026-07-08T12:00:00Z' }, IST)).toBe(false);
  });
});

describe('array operators', () => {
  it('CONTAINS_ALL / CONTAINS_ANY', () => {
    expect(run(cmp('t', 'CONTAINS_ALL', ['a', 'b']), { t: ['a', 'b', 'c'] })).toBe(true);
    expect(run(cmp('t', 'CONTAINS_ALL', ['a', 'z']), { t: ['a', 'b'] })).toBe(false);
    expect(run(cmp('t', 'CONTAINS_ANY', ['z', 'b']), { t: ['a', 'b'] })).toBe(true);
  });

  it('LENGTH_EQ / GT / LT', () => {
    expect(run(cmp('t', 'LENGTH_EQ', 3), { t: [1, 2, 3] })).toBe(true);
    expect(run(cmp('t', 'LENGTH_GT', 2), { t: [1, 2, 3] })).toBe(true);
    expect(run(cmp('t', 'LENGTH_LT', 2), { t: [1, 2, 3] })).toBe(false);
  });

  it('ANY_ITEM_MATCHES / ALL_ITEMS_MATCH run a sub-condition per element', () => {
    const data = { items: [{ cat: 'Office' }, { cat: 'Controlled' }] };
    const any = cmp('items', 'ANY_ITEM_MATCHES', cmp('cat', '=', 'Controlled'));
    const all = cmp('items', 'ALL_ITEMS_MATCH', cmp('cat', '=', 'Controlled'));
    expect(run(any, data)).toBe(true); // one flagged item among clean ones (scenario 18)
    expect(run(all, data)).toBe(false);
  });
});

describe('existence operators (distinct from IS_NULL)', () => {
  it('EXISTS is true even for an explicit null; NOT_EXISTS needs an absent key', () => {
    expect(run(cmp('a', 'EXISTS'), { a: null })).toBe(true);
    expect(run(cmp('a', 'EXISTS'), {})).toBe(false);
    expect(run(cmp('a', 'NOT_EXISTS'), {})).toBe(true);
    expect(run(cmp('a', 'NOT_EXISTS'), { a: null })).toBe(false);
    // IS_NULL, by contrast, is true for both missing and explicit null
    expect(run(cmp('a', 'IS_NULL'), { a: null })).toBe(true);
    expect(run(cmp('a', 'IS_NULL'), {})).toBe(true);
  });
});

describe('managed-list operators (IN_LIST / NOT_IN_LIST)', () => {
  const lists = {
    Blocklist: ['CN', 'RU', 'KP'],
    VipTiers: [1, 2, 3],
  };
  const opts: EvaluateOptions = { managedLists: lists };

  it('IN_LIST membership resolves against the injected list', () => {
    expect(run(cmp('country', 'IN_LIST', 'Blocklist'), { country: 'CN' }, opts)).toBe(true);
    expect(run(cmp('country', 'IN_LIST', 'Blocklist'), { country: 'US' }, opts)).toBe(false);
  });

  it('NOT_IN_LIST is the inverse for a present list', () => {
    expect(run(cmp('country', 'NOT_IN_LIST', 'Blocklist'), { country: 'US' }, opts)).toBe(true);
    expect(run(cmp('country', 'NOT_IN_LIST', 'Blocklist'), { country: 'CN' }, opts)).toBe(false);
  });

  it('matches a numeric list by natural type', () => {
    expect(run(cmp('tier', 'IN_LIST', 'VipTiers'), { tier: 2 }, opts)).toBe(true);
    expect(run(cmp('tier', 'IN_LIST', 'VipTiers'), { tier: 9 }, opts)).toBe(false);
  });

  it('coerces a string payload against a numeric list when the field is declared number', () => {
    const schema: FieldSchema = { tier: 'number' };
    expect(run(cmp('tier', 'IN_LIST', 'VipTiers'), { tier: '2' }, { ...opts, fieldSchema: schema })).toBe(
      true,
    );
  });

  it('an absent list fails closed in both directions and notes missing_list', () => {
    expect(run(cmp('country', 'IN_LIST', 'Ghost'), { country: 'CN' }, opts)).toBe(false);
    expect(run(cmp('country', 'NOT_IN_LIST', 'Ghost'), { country: 'CN' }, opts)).toBe(false);
    expect(notesOf(cmp('country', 'IN_LIST', 'Ghost'), { country: 'CN' }, opts)).toContain(
      'missing_list',
    );
  });

  it('an empty list name is an invalid operand', () => {
    expect(notesOf(cmp('country', 'IN_LIST', ''), { country: 'CN' }, opts)).toContain(
      'invalid_operand',
    );
  });
});

describe('cross-field comparison (valueType: field)', () => {
  it('compares two payload fields', () => {
    expect(run(cmp('discount', '>', 'order', 'field'), { discount: 600, order: 1000 })).toBe(false);
    expect(run(cmp('discount', '>', 'threshold', 'field'), { discount: 600, threshold: 500 })).toBe(true);
  });

  it('missing referenced field yields cross_field_missing', () => {
    expect(run(cmp('a', '>', 'b', 'field'), { a: 5 })).toBe(false);
    expect(notesOf(cmp('a', '>', 'b', 'field'), { a: 5 })).toContain('cross_field_missing');
  });

  it('warns (does not fail) on mismatched declared units', () => {
    const schema: FieldSchema = {
      inr: { type: 'number', unit: 'currency:INR' },
      usd: { type: 'number', unit: 'currency:USD' },
    };
    const node = cmp('inr', '>', 'usd', 'field');
    expect(run(node, { inr: 100, usd: 50 }, { fieldSchema: schema })).toBe(true);
    expect(notesOf(node, { inr: 100, usd: 50 }, { fieldSchema: schema })).toContain('unit_mismatch');
  });
});

describe('default_if_missing', () => {
  it('substitutes the declared default and notes it', () => {
    const schema: FieldSchema = { urgent: { type: 'boolean', defaultIfMissing: false } };
    const node = cmp('urgent', '=', false);
    expect(run(node, {}, { fieldSchema: schema })).toBe(true);
    expect(notesOf(node, {}, { fieldSchema: schema })).toContain('default_applied');
  });

  it('still fails missing when no default is declared', () => {
    const schema: FieldSchema = { urgent: { type: 'boolean' } };
    expect(notesOf(cmp('urgent', '=', true), {}, { fieldSchema: schema })).toContain('missing_field');
  });
});

describe('operator ↔ type legality', () => {
  it('operatorsForType filters the dropdown set', () => {
    expect(operatorsForType('number')).toContain('MULTIPLE_OF');
    expect(operatorsForType('number')).not.toContain('STARTS_WITH');
    expect(operatorsForType('string')).toContain('EQUALS_IGNORE_CASE');
    expect(operatorsForType('date')).toContain('DAY_OF_WEEK_IN');
  });

  it('isOperatorLegalForType allows universal + array ops, blocks the rest', () => {
    expect(isOperatorLegalForType('IS_NULL', 'number')).toBe(true);
    expect(isOperatorLegalForType('ANY_ITEM_MATCHES', 'number')).toBe(true); // array ops always ok
    expect(isOperatorLegalForType('STARTS_WITH', 'number')).toBe(false);
  });

  it('validateConditionAst flags an illegal operator when a schema is supplied', () => {
    const schema: FieldSchema = { amount: 'number' };
    const bad = validateConditionAst(cmp('amount', 'STARTS_WITH', 'x'), schema);
    expect(bad.valid).toBe(false);
    expect(bad.issues.map((i) => i.message).join(' ')).toContain('not valid for number');
    // Without a schema the same AST is structurally valid
    expect(validateConditionAst(cmp('amount', 'STARTS_WITH', 'x')).valid).toBe(true);
  });

  it('validates a nested sub-condition for ANY_ITEM_MATCHES', () => {
    const good = validateConditionAst(cmp('items', 'ANY_ITEM_MATCHES', cmp('cat', '=', 'X')));
    expect(good.valid).toBe(true);
    const bad = validateConditionAst(cmp('items', 'ANY_ITEM_MATCHES', 'not-a-node'));
    expect(bad.valid).toBe(false);
  });

  it('validates a cross-field valueType path', () => {
    expect(validateConditionAst(cmp('a', '>', 'b', 'field')).valid).toBe(true);
    expect(validateConditionAst(cmp('a', '>', 'not a path!', 'field')).valid).toBe(false);
  });
});

describe('catch-all / fallback rule (B.3 #15)', () => {
  it('a root empty-AND matches every payload and counts zero comparisons', () => {
    const ast = catchAllAst();
    expect(run(ast, {})).toBe(true);
    expect(run(ast, { anything: 1 })).toBe(true);
    expect(countComparisons(ast)).toBe(0);
    expect(isCatchAllAst(ast)).toBe(true);
    expect(isCatchAllAst(cmp('a', '=', 1))).toBe(false);
  });

  it('validation allows an empty AND only at the root', () => {
    expect(validateConditionAst({ operator: 'AND', children: [] }).valid).toBe(true);
    // A nested empty group is still an authoring mistake
    const nested = { operator: 'AND', children: [{ operator: 'OR', children: [] }] };
    expect(validateConditionAst(nested).valid).toBe(false);
    // An empty OR at the root is false-always, not a catch-all → rejected
    expect(validateConditionAst({ operator: 'OR', children: [] }).valid).toBe(false);
  });
});
