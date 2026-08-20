import { describe, expect, it } from 'vitest';
import type { ConditionNode } from '../src/rule-evaluator/types';
import { countComparisons, validateConditionAst } from '../src/rule-evaluator/validate';

const cmp = (field: string, operator: string, value?: unknown) =>
  ({ field, operator, value }) as unknown as ConditionNode;

describe('validateConditionAst', () => {
  it('accepts the spec example', () => {
    const ast = {
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
    };
    expect(validateConditionAst(ast)).toEqual({ valid: true, issues: [] });
  });

  it.each([
    [null, 'Node must be an object'],
    [[], 'Node must be an object'],
    [{}, 'missing an operator'],
    [{ operator: 'XOR', field: 'a', value: 1 }, 'Unknown operator'],
    [{ operator: 'AND' }, 'children array'],
    // A nested empty group remains an authoring mistake (root empty-AND is the
    // one exception — see the catch-all test below).
    [{ operator: 'AND', children: [{ operator: 'OR', children: [] }] }, 'non-empty children'],
    [{ operator: 'OR', children: [] }, 'non-empty children'],
    [{ operator: '=', value: 1 }, 'requires a field'],
    [{ operator: '=', field: 'a' }, 'requires a value'],
    [{ operator: '=', field: '1bad', value: 1 }, 'Invalid field path'],
    [{ operator: '=', field: 'a;drop', value: 1 }, 'Invalid field path'],
    [{ operator: 'IN', field: 'a', value: 'not-array' }, 'requires a non-empty array'],
    [{ operator: 'IN', field: 'a', value: [] }, 'requires a non-empty array'],
    [{ operator: 'BETWEEN', field: 'a', value: [1] }, '[min, max]'],
    [{ operator: 'BETWEEN', field: 'a', value: 5 }, '[min, max]'],
    [{ operator: 'IS_NULL', field: 'a', value: 1 }, 'does not take a value'],
    [{ operator: 'MATCHES_REGEX', field: 'a', value: '([bad' }, 'Invalid regular expression'],
    [{ operator: 'MATCHES_REGEX', field: 'a', value: '(a+)+$' }, 'ReDoS'],
    [{ operator: 'MATCHES_REGEX', field: 'a' }, 'pattern string'],
  ])('rejects %j', (ast, messageFragment) => {
    const result = validateConditionAst(ast);
    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.message).join(' | ')).toContain(messageFragment);
  });

  it('accepts a root empty-AND as the catch-all rule (B.3 #15)', () => {
    expect(validateConditionAst({ operator: 'AND', children: [] }).valid).toBe(true);
  });

  it('NOT takes exactly one child', () => {
    expect(validateConditionAst({ operator: 'NOT', children: [cmp('a', '=', 1)] }).valid).toBe(
      true,
    );
    const twoChildren = validateConditionAst({
      operator: 'NOT',
      children: [cmp('a', '=', 1), cmp('b', '=', 2)],
    });
    expect(twoChildren.valid).toBe(false);
    expect(twoChildren.issues[0]?.message).toContain('exactly one child');
  });

  it('accepts dot paths and array indexes as fields', () => {
    expect(validateConditionAst(cmp('vendor.country', '=', 'India')).valid).toBe(true);
    expect(validateConditionAst(cmp('items[0].category', '=', 'x')).valid).toBe(true);
  });

  it('enforces the depth cap of 10', () => {
    // depth 10 total (9 logical wrappers + leaf) is fine
    let ok: ConditionNode = cmp('a', '=', 1);
    for (let i = 0; i < 9; i++) ok = { operator: 'NOT', children: [ok] };
    expect(validateConditionAst(ok).valid).toBe(true);

    let deep: ConditionNode = cmp('a', '=', 1);
    for (let i = 0; i < 10; i++) deep = { operator: 'NOT', children: [deep] };
    const result = validateConditionAst(deep);
    expect(result.valid).toBe(false);
    expect(result.issues[0]?.message).toContain('depth');
  });

  it('enforces the node-count cap', () => {
    const wide = {
      operator: 'AND',
      children: Array.from({ length: 250 }, (_, i) => cmp(`f${i}`, '=', i)),
    };
    const result = validateConditionAst(wide);
    expect(result.valid).toBe(false);
    expect(result.issues[0]?.message).toContain('maximum of 200 nodes');
  });

  it('reports issue paths pointing at the offending node', () => {
    const result = validateConditionAst({
      operator: 'AND',
      children: [cmp('a', '=', 1), { operator: 'BOGUS', field: 'b', value: 2 }],
    });
    expect(result.issues[0]?.path).toBe('root[1]');
  });
});

describe('countComparisons', () => {
  it('counts leaves through nesting', () => {
    expect(countComparisons(cmp('a', '=', 1) as ConditionNode)).toBe(1);
    expect(
      countComparisons({
        operator: 'AND',
        children: [
          cmp('a', '=', 1),
          { operator: 'OR', children: [cmp('b', '>', 2), cmp('c', '<', 3)] },
          { operator: 'NOT', children: [cmp('d', 'IS_NULL')] },
        ],
      }),
    ).toBe(4);
  });
});
