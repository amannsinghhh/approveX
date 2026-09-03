import { describe, expect, it } from 'vitest';
import type { ConditionNode, EvaluateOptions } from '../../shared/src/rule-evaluator';
import { evaluateCondition } from '../../shared/src/rule-evaluator';

/**
 * collectTrace:false (the Phase 7 ranking fast path) must produce IDENTICAL
 * verdicts to the traced evaluator — it only skips trace allocation and is
 * allowed to short-circuit.
 */
describe('trace-free fast path', () => {
  const asts: {
    name: string;
    ast: ConditionNode;
    data: Record<string, unknown>;
    options?: EvaluateOptions;
  }[] = [
    {
      name: 'simple comparison true',
      ast: { field: 'amount', operator: '>', value: 100 },
      data: { amount: 500 },
    },
    {
      name: 'simple comparison false',
      ast: { field: 'amount', operator: '>', value: 100 },
      data: { amount: 50 },
    },
    {
      name: 'missing field',
      ast: { field: 'nope', operator: '=', value: 1 },
      data: { amount: 1 },
    },
    {
      name: 'AND with failing branch',
      ast: {
        operator: 'AND',
        children: [
          { field: 'amount', operator: '>', value: 100 },
          { field: 'category', operator: '=', value: 'x' },
        ],
      },
      data: { amount: 500, category: 'y' },
    },
    {
      name: 'OR with early true',
      ast: {
        operator: 'OR',
        children: [
          { field: 'amount', operator: '>', value: 100 },
          { field: 'category', operator: '=', value: 'x' },
        ],
      },
      data: { amount: 500, category: 'y' },
    },
    {
      name: 'NOT',
      ast: { operator: 'NOT', children: [{ field: 'amount', operator: '>', value: 100 }] },
      data: { amount: 50 },
    },
    {
      name: 'nested logic + type mismatch',
      ast: {
        operator: 'AND',
        children: [
          {
            operator: 'OR',
            children: [
              { field: 'amount', operator: 'BETWEEN', value: [10, 100] },
              { field: 'tags', operator: 'CONTAINS', value: 'vip' },
            ],
          },
          { field: 'amount', operator: '=', value: 'not-a-number' },
        ],
      },
      data: { amount: 50, tags: ['vip'] },
    },
    {
      name: 'IN_LIST hit via injected managed list',
      ast: { field: 'country', operator: 'IN_LIST', value: 'Blocklist' },
      data: { country: 'CN' },
      options: { managedLists: { Blocklist: ['CN', 'RU'] } },
    },
    {
      name: 'IN_LIST miss on absent list (fails closed)',
      ast: { field: 'country', operator: 'IN_LIST', value: 'Ghost' },
      data: { country: 'CN' },
    },
  ];

  it.each(asts)('verdict parity: $name', ({ ast, data, options }) => {
    const traced = evaluateCondition(ast, data, options);
    const fast = evaluateCondition(ast, data, { ...options, collectTrace: false });
    expect(fast.matched).toBe(traced.matched);
    expect(fast.trace).toEqual([]);
    expect(traced.trace.length).toBeGreaterThan(0);
  });

  it('respects the field schema in both paths', () => {
    const ast: ConditionNode = { field: 'amount', operator: '>', value: 100 };
    const data = { amount: '500' }; // string needs declared-number coercion
    const schema = { amount: 'number' as const };
    expect(evaluateCondition(ast, data).matched).toBe(false);
    expect(evaluateCondition(ast, data, { collectTrace: false }).matched).toBe(false);
    expect(evaluateCondition(ast, data, { fieldSchema: schema }).matched).toBe(true);
    expect(evaluateCondition(ast, data, { fieldSchema: schema, collectTrace: false }).matched).toBe(
      true,
    );
  });
});
