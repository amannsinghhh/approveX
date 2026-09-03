import { describe, expect, it } from 'vitest';
import { evaluateCondition } from '../../shared/src/rule-evaluator/evaluate';
import type {
  ComparisonOperator,
  ConditionNode,
  FieldSchema,
  TraceNote,
} from '../../shared/src/rule-evaluator/types';

const cmp = (field: string, operator: ComparisonOperator, value?: unknown): ConditionNode => ({
  field,
  operator,
  value,
});

/** Shorthand: evaluate a single comparison and return its result. */
const evalCmp = (node: ConditionNode, data: unknown, fieldSchema?: FieldSchema): boolean =>
  evaluateCondition(node, data, { fieldSchema }).matched;

/** Shorthand: evaluate and return the leaf trace notes. */
const leafNotes = (node: ConditionNode, data: unknown, fieldSchema?: FieldSchema): TraceNote[] => {
  const { trace } = evaluateCondition(node, data, { fieldSchema });
  return trace[0]?.notes ?? [];
};

describe('equality (= and !=)', () => {
  it.each([
    [cmp('n', '=', 5), { n: 5 }, true],
    [cmp('n', '=', 5), { n: 6 }, false],
    [cmp('s', '=', 'India'), { s: 'India' }, true],
    [cmp('s', '=', 'India'), { s: 'india' }, false],
    [cmp('b', '=', true), { b: true }, true],
    [cmp('b', '=', false), { b: true }, false],
    [cmp('n', '!=', 5), { n: 6 }, true],
    [cmp('n', '!=', 5), { n: 5 }, false],
  ])('%j on %j → %s', (node, data, expected) => {
    expect(evalCmp(node, data)).toBe(expected);
  });

  it('array equality is deep for primitives', () => {
    expect(evalCmp(cmp('a', '=', [1, 2]), { a: [1, 2] })).toBe(true);
    expect(evalCmp(cmp('a', '=', [1, 2]), { a: [2, 1] })).toBe(false);
  });

  it('type mismatch is false for BOTH = and != (spec: no silent coercion)', () => {
    expect(evalCmp(cmp('n', '=', 5), { n: '5' })).toBe(false);
    expect(leafNotes(cmp('n', '=', 5), { n: '5' })).toContain('type_mismatch');
    // != would be "true" under loose semantics; the spec pins it to false
    expect(evalCmp(cmp('n', '!=', 5), { n: '5' })).toBe(false);
    expect(leafNotes(cmp('n', '!=', 5), { n: '5' })).toContain('type_mismatch');
    expect(evalCmp(cmp('b', '=', true), { b: 'true' })).toBe(false);
    expect(evalCmp(cmp('n', '=', '5'), { n: 5 })).toBe(false);
  });

  it('numeric strings compare numerically ONLY when the field is registered numeric', () => {
    const schema: FieldSchema = { amount: 'number' };
    expect(evalCmp(cmp('amount', '=', 100000), { amount: '100000' }, schema)).toBe(true);
    expect(evalCmp(cmp('amount', '=', '100000'), { amount: 100000 }, schema)).toBe(true);
    // Same payload without the schema: mismatch
    expect(evalCmp(cmp('amount', '=', 100000), { amount: '100000' })).toBe(false);
    // Garbage string on a numeric field: mismatch, not NaN weirdness
    expect(evalCmp(cmp('amount', '=', 100000), { amount: 'lots' }, schema)).toBe(false);
    expect(leafNotes(cmp('amount', '=', 100000), { amount: 'lots' }, schema)).toContain(
      'type_mismatch',
    );
  });

  it('boolean fields never coerce strings', () => {
    const schema: FieldSchema = { urgent: 'boolean' };
    expect(evalCmp(cmp('urgent', '=', true), { urgent: 'true' }, schema)).toBe(false);
    expect(leafNotes(cmp('urgent', '=', true), { urgent: 'true' }, schema)).toContain(
      'type_mismatch',
    );
  });

  it('date fields compare by instant with mixed formats', () => {
    const schema: FieldSchema = { due: 'date' };
    expect(
      evalCmp(cmp('due', '=', '2026-07-08T00:00:00.000Z'), { due: '2026-07-08T00:00:00Z' }, schema),
    ).toBe(true);
  });
});

describe('ordering (>, >=, <, <=)', () => {
  it.each([
    [cmp('n', '>', 10), { n: 11 }, true],
    [cmp('n', '>', 10), { n: 10 }, false],
    [cmp('n', '>=', 10), { n: 10 }, true],
    [cmp('n', '<', 10), { n: 9 }, true],
    [cmp('n', '<', 10), { n: 10 }, false],
    [cmp('n', '<=', 10), { n: 10 }, true],
    [cmp('n', '<=', 10), { n: 11 }, false],
  ])('%j on %j → %s', (node, data, expected) => {
    expect(evalCmp(node, data)).toBe(expected);
  });

  it('strings compare lexicographically when both sides are strings', () => {
    expect(evalCmp(cmp('s', '>', 'apple'), { s: 'banana' })).toBe(true);
    expect(evalCmp(cmp('s', '<', 'apple'), { s: 'banana' })).toBe(false);
  });

  it('mixed types are false with a note, never coerced', () => {
    expect(evalCmp(cmp('n', '>', 10), { n: '11' })).toBe(false);
    expect(leafNotes(cmp('n', '>', 10), { n: '11' })).toContain('type_mismatch');
    expect(evalCmp(cmp('n', '>', '10'), { n: 11 })).toBe(false);
    expect(evalCmp(cmp('n', '>', true), { n: 1 })).toBe(false);
  });

  it('numeric schema coerces numeric strings for ordering', () => {
    const schema: FieldSchema = { amount: 'number' };
    expect(evalCmp(cmp('amount', '>', 100000), { amount: '200000' }, schema)).toBe(true);
    expect(evalCmp(cmp('amount', '>', '100000'), { amount: 200000 }, schema)).toBe(true);
    expect(evalCmp(cmp('amount', '>', 100000), { amount: '99999' }, schema)).toBe(false);
  });

  it('date schema orders ISO strings by instant', () => {
    const schema: FieldSchema = { due: 'date' };
    expect(evalCmp(cmp('due', '>', '2026-01-01'), { due: '2026-06-15' }, schema)).toBe(true);
    expect(evalCmp(cmp('due', '<', '2026-01-01'), { due: '2026-06-15' }, schema)).toBe(false);
    expect(evalCmp(cmp('due', '>', '2026-01-01'), { due: 'not-a-date' }, schema)).toBe(false);
  });

  it('NaN never matches', () => {
    expect(evalCmp(cmp('n', '>', NaN), { n: 5 })).toBe(false);
    expect(evalCmp(cmp('n', '=', NaN), { n: NaN })).toBe(false);
  });
});

describe('IN / NOT_IN', () => {
  it.each([
    [cmp('dept', 'IN', ['Finance', 'Procurement']), { dept: 'Finance' }, true],
    [cmp('dept', 'IN', ['Finance', 'Procurement']), { dept: 'HR' }, false],
    [cmp('dept', 'NOT_IN', ['Finance']), { dept: 'HR' }, true],
    [cmp('dept', 'NOT_IN', ['Finance']), { dept: 'Finance' }, false],
    [cmp('n', 'IN', [1, 2, 3]), { n: 2 }, true],
    [cmp('n', 'IN', [1, 2, 3]), { n: '2' }, false], // no coercion without schema
  ])('%j on %j → %s', (node, data, expected) => {
    expect(evalCmp(node, data)).toBe(expected);
  });

  it('IN coerces per element under a numeric schema', () => {
    const schema: FieldSchema = { n: 'number' };
    expect(evalCmp(cmp('n', 'IN', [1, 2, 3]), { n: '2' }, schema)).toBe(true);
    expect(evalCmp(cmp('n', 'IN', ['1', '2']), { n: 2 }, schema)).toBe(true);
  });

  it('non-array operand is false with a note', () => {
    expect(evalCmp(cmp('n', 'IN', 'oops'), { n: 1 })).toBe(false);
    expect(leafNotes(cmp('n', 'IN', 'oops'), { n: 1 })).toContain('invalid_operand');
  });

  it('NOT_IN on a missing field is false (missing ≠ "not in the list")', () => {
    expect(evalCmp(cmp('dept', 'NOT_IN', ['Finance']), {})).toBe(false);
    expect(leafNotes(cmp('dept', 'NOT_IN', ['Finance']), {})).toContain('missing_field');
  });
});

describe('string operators', () => {
  it.each([
    [cmp('s', 'CONTAINS', 'llo'), { s: 'hello' }, true],
    [cmp('s', 'CONTAINS', 'xyz'), { s: 'hello' }, false],
    [cmp('s', 'STARTS_WITH', 'he'), { s: 'hello' }, true],
    [cmp('s', 'STARTS_WITH', 'lo'), { s: 'hello' }, false],
    [cmp('s', 'ENDS_WITH', 'lo'), { s: 'hello' }, true],
    [cmp('s', 'ENDS_WITH', 'he'), { s: 'hello' }, false],
  ])('%j on %j → %s', (node, data, expected) => {
    expect(evalCmp(node, data)).toBe(expected);
  });

  it('CONTAINS also does array membership', () => {
    expect(evalCmp(cmp('tags', 'CONTAINS', 'urgent'), { tags: ['urgent', 'q3'] })).toBe(true);
    expect(evalCmp(cmp('tags', 'CONTAINS', 'x'), { tags: ['urgent'] })).toBe(false);
    expect(evalCmp(cmp('nums', 'CONTAINS', 3), { nums: [1, 2, 3] })).toBe(true);
  });

  it('non-string subjects are type mismatches', () => {
    expect(evalCmp(cmp('n', 'STARTS_WITH', '1'), { n: 123 })).toBe(false);
    expect(leafNotes(cmp('n', 'STARTS_WITH', '1'), { n: 123 })).toContain('type_mismatch');
    expect(evalCmp(cmp('n', 'CONTAINS', '2'), { n: 123 })).toBe(false);
  });
});

describe('BETWEEN', () => {
  it.each([
    [cmp('n', 'BETWEEN', [10, 20]), { n: 15 }, true],
    [cmp('n', 'BETWEEN', [10, 20]), { n: 10 }, true], // inclusive low
    [cmp('n', 'BETWEEN', [10, 20]), { n: 20 }, true], // inclusive high
    [cmp('n', 'BETWEEN', [10, 20]), { n: 9 }, false],
    [cmp('n', 'BETWEEN', [10, 20]), { n: 21 }, false],
  ])('%j on %j → %s', (node, data, expected) => {
    expect(evalCmp(node, data)).toBe(expected);
  });

  it('works on dates with a schema', () => {
    const schema: FieldSchema = { due: 'date' };
    expect(
      evalCmp(cmp('due', 'BETWEEN', ['2026-01-01', '2026-12-31']), { due: '2026-07-08' }, schema),
    ).toBe(true);
    expect(
      evalCmp(cmp('due', 'BETWEEN', ['2026-01-01', '2026-12-31']), { due: '2027-01-01' }, schema),
    ).toBe(false);
  });

  it('malformed bounds are invalid_operand', () => {
    expect(evalCmp(cmp('n', 'BETWEEN', [10]), { n: 15 })).toBe(false);
    expect(leafNotes(cmp('n', 'BETWEEN', [10]), { n: 15 })).toContain('invalid_operand');
  });

  it('unorderable bounds are type_mismatch', () => {
    expect(evalCmp(cmp('n', 'BETWEEN', [10, 'x']), { n: 15 })).toBe(false);
    expect(leafNotes(cmp('n', 'BETWEEN', [10, 'x']), { n: 15 })).toContain('type_mismatch');
  });
});

describe('IS_NULL / IS_NOT_NULL', () => {
  it.each([
    [cmp('a', 'IS_NULL'), { a: null }, true],
    [cmp('a', 'IS_NULL'), {}, true], // missing counts as null
    [cmp('a', 'IS_NULL'), { a: 0 }, false],
    [cmp('a', 'IS_NULL'), { a: '' }, false],
    [cmp('a', 'IS_NULL'), { a: false }, false],
    [cmp('a', 'IS_NOT_NULL'), { a: 0 }, true],
    [cmp('a', 'IS_NOT_NULL'), { a: null }, false],
    [cmp('a', 'IS_NOT_NULL'), {}, false],
  ])('%j on %j → %s', (node, data, expected) => {
    expect(evalCmp(node, data)).toBe(expected);
  });
});

describe('MATCHES_REGEX', () => {
  it('matches and non-matches', () => {
    expect(
      evalCmp(cmp('pan', 'MATCHES_REGEX', '^[A-Z]{5}\\d{4}[A-Z]$'), { pan: 'ABCDE1234F' }),
    ).toBe(true);
    expect(evalCmp(cmp('pan', 'MATCHES_REGEX', '^[A-Z]{5}\\d{4}[A-Z]$'), { pan: 'nope' })).toBe(
      false,
    );
  });

  it('non-string subject is type_mismatch', () => {
    expect(evalCmp(cmp('n', 'MATCHES_REGEX', '\\d+'), { n: 123 })).toBe(false);
    expect(leafNotes(cmp('n', 'MATCHES_REGEX', '\\d+'), { n: 123 })).toContain('type_mismatch');
  });

  it('unsafe pattern is false with unsafe_regex note', () => {
    expect(evalCmp(cmp('s', 'MATCHES_REGEX', '(a+)+$'), { s: 'aaa' })).toBe(false);
    expect(leafNotes(cmp('s', 'MATCHES_REGEX', '(a+)+$'), { s: 'aaa' })).toContain('unsafe_regex');
  });

  it('catastrophic backtracking times out to false instead of hanging', () => {
    const node = cmp('s', 'MATCHES_REGEX', '^(a|a)+$');
    const data = { s: 'a'.repeat(40) + 'b' };
    const started = Date.now();
    const { matched, trace } = evaluateCondition(node, data, { regexTimeoutMs: 25 });
    expect(Date.now() - started).toBeLessThan(2000);
    expect(matched).toBe(false);
    expect(trace[0]?.notes).toContain('regex_timeout');
  });
});

describe('missing fields (spec: never throw, policy applies upstream)', () => {
  const operators: [ComparisonOperator, unknown][] = [
    ['=', 1],
    ['!=', 1],
    ['>', 1],
    ['>=', 1],
    ['<', 1],
    ['<=', 1],
    ['IN', [1]],
    ['NOT_IN', [1]],
    ['CONTAINS', 'x'],
    ['STARTS_WITH', 'x'],
    ['ENDS_WITH', 'x'],
    ['BETWEEN', [1, 2]],
    ['MATCHES_REGEX', 'x'],
  ];
  it.each(operators)('%s on a missing field → false + missing_field', (operator, value) => {
    const node = cmp('ghost', operator, value);
    expect(evalCmp(node, { present: 1 })).toBe(false);
    expect(leafNotes(node, { present: 1 })).toContain('missing_field');
  });

  it('explicit null behaves like missing for value comparisons', () => {
    expect(evalCmp(cmp('a', '=', 1), { a: null })).toBe(false);
    expect(leafNotes(cmp('a', '=', 1), { a: null })).toContain('missing_field');
  });
});

describe('logical operators', () => {
  const T = cmp('x', '=', 1);
  const F = cmp('x', '=', 2);
  const data = { x: 1 };

  it.each([
    [{ operator: 'AND', children: [T, T] }, true],
    [{ operator: 'AND', children: [T, F] }, false],
    [{ operator: 'OR', children: [F, T] }, true],
    [{ operator: 'OR', children: [F, F] }, false],
    [{ operator: 'NOT', children: [F] }, true],
    [{ operator: 'NOT', children: [T] }, false],
  ] as [ConditionNode, boolean][])('%j → %s', (node, expected) => {
    expect(evalCmp(node, data)).toBe(expected);
  });

  it('handles the full spec example with nesting', () => {
    const ast: ConditionNode = {
      operator: 'AND',
      children: [
        cmp('amount', '>', 100000),
        cmp('country', '=', 'India'),
        {
          operator: 'OR',
          children: [cmp('department', 'IN', ['Finance', 'Procurement']), cmp('urgent', '=', true)],
        },
      ],
    };
    expect(evalCmp(ast, { amount: 200000, country: 'India', department: 'Finance' })).toBe(true);
    expect(evalCmp(ast, { amount: 200000, country: 'India', department: 'HR', urgent: true })).toBe(
      true,
    );
    expect(evalCmp(ast, { amount: 200000, country: 'India', department: 'HR' })).toBe(false);
    expect(evalCmp(ast, { amount: 50, country: 'India', department: 'Finance' })).toBe(false);
  });

  it('NOT over a missing field: the comparison is false, so NOT is true', () => {
    // Documented consequence of missing → false at the leaf level.
    expect(evalCmp({ operator: 'NOT', children: [cmp('ghost', '=', 1)] }, {})).toBe(true);
  });

  it('deep nesting evaluates correctly', () => {
    let node: ConditionNode = T;
    for (let i = 0; i < 8; i++) node = { operator: 'NOT', children: [node] };
    expect(evalCmp(node, data)).toBe(true); // even number of NOTs
  });
});

describe('evaluation trace', () => {
  it('produces one entry per node with paths, results, and actuals', () => {
    const ast: ConditionNode = {
      operator: 'AND',
      children: [
        cmp('amount', '>', 100000),
        { operator: 'OR', children: [cmp('urgent', '=', true), cmp('dept', '=', 'Finance')] },
      ],
    };
    const { matched, trace } = evaluateCondition(ast, {
      amount: 200000,
      dept: 'Finance',
    });
    expect(matched).toBe(true);
    expect(trace).toHaveLength(5); // 3 leaves + OR + AND

    const byPath = Object.fromEntries(trace.map((entry) => [entry.nodePath, entry]));
    expect(byPath['root[0]']).toMatchObject({
      operator: '>',
      field: 'amount',
      expected: 100000,
      actual: 200000,
      result: true,
    });
    expect(byPath['root[1][0]']).toMatchObject({ result: false, notes: ['missing_field'] });
    expect(byPath['root[1][1]']).toMatchObject({ result: true, actual: 'Finance' });
    expect(byPath['root[1]']).toMatchObject({ operator: 'OR', result: true });
    expect(byPath['root']).toMatchObject({ operator: 'AND', result: true });
  });

  it('does not short-circuit: all branches appear in the trace', () => {
    const ast: ConditionNode = {
      operator: 'AND',
      children: [cmp('a', '=', 'nope'), cmp('b', '=', 1), cmp('c', '=', 2)],
    };
    const { trace } = evaluateCondition(ast, { a: 'x', b: 1, c: 2 });
    expect(trace.filter((entry) => entry.nodePath !== 'root')).toHaveLength(3);
  });

  it('flags unknown fields when a schema is provided, without changing the result', () => {
    const schema: FieldSchema = { amount: 'number' };
    const { matched, trace } = evaluateCondition(
      cmp('customField', '=', 'x'),
      { customField: 'x' },
      { fieldSchema: schema },
    );
    expect(matched).toBe(true);
    expect(trace[0]?.notes).toContain('unknown_field');
  });
});
