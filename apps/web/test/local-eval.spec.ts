/**
 * Tester/API parity for the Rule Builder "Check your work" panel.
 *
 * The panel evaluates drafts in the browser with the shared evaluator. The bug:
 * it fed the evaluator a schema of bare type strings (dropping FieldMeta like
 * defaultIfMissing) and no managed lists, so verdicts diverged from what
 * POST /evaluate returns for the same rule + payload. These tests pin the
 * browser-side option building (local-eval.ts) to the API's construction
 * (apps/api/src/rules/rule-cache.service.ts getFieldSchema/getManagedLists).
 */
import { describe, expect, it } from 'vitest';
import type { ConditionNode } from '@approvex/shared';
import { evaluateCondition } from '@approvex/shared';
import { parseTyped } from '../src/components/condition-builder';
import { buildLocalEvalOptions } from '../src/lib/local-eval';
import type { FieldDefinition, ManagedList } from '../src/lib/types';

const field = (
  name: string,
  type: FieldDefinition['type'],
  extra: Partial<FieldDefinition> = {},
): FieldDefinition => ({ id: `id-${name}`, name, type, description: null, ...extra });

const list = (name: string, values: string[]): ManagedList => ({
  id: `id-${name}`,
  name,
  description: null,
  values,
  createdAt: '',
  updatedAt: '',
});

const cmp = (f: string, operator: string, value?: unknown): ConditionNode =>
  ({ field: f, operator, value }) as ConditionNode;
const and = (...children: ConditionNode[]): ConditionNode =>
  ({ operator: 'AND', children }) as ConditionNode;
const or = (...children: ConditionNode[]): ConditionNode =>
  ({ operator: 'OR', children }) as ConditionNode;

const notes = (result: ReturnType<typeof evaluateCondition>): string[] =>
  result.trace.flatMap((entry) => entry.notes ?? []);

describe('the "Check your work" bug: defaultIfMissing was dropped', () => {
  const fields = [field('amount', 'number'), field('risk_score', 'number', { defaultIfMissing: 0 })];
  const rule = and(cmp('amount', '>', 100000), cmp('risk_score', '<=', 50));
  const payload = { amount: 200000 }; // risk_score omitted — the API applies the declared default

  it('reproduces the wrong verdict with the old bare-type schema', () => {
    const bare = Object.fromEntries(fields.map((f) => [f.name, f.type]));
    expect(evaluateCondition(rule, payload, { fieldSchema: bare }).matched).toBe(false);
  });

  it('matches like the API once full field meta is passed', () => {
    const result = evaluateCondition(rule, payload, buildLocalEvalOptions(fields));
    expect(result.matched).toBe(true);
    expect(notes(result)).toContain('default_applied');
  });
});

describe('managed lists reach the tester (was: IN_LIST always failed closed)', () => {
  const fields = [field('vendor', 'string')];
  const lists = [list('HighRiskVendors', ['acme', 'globex'])];
  const rule = cmp('vendor', 'IN_LIST', 'HighRiskVendors');

  it('matches a value present in the list', () => {
    const result = evaluateCondition(rule, { vendor: 'acme' }, buildLocalEvalOptions(fields, lists));
    expect(result.matched).toBe(true);
  });

  it('does not match a value absent from the list', () => {
    const result = evaluateCondition(
      rule,
      { vendor: 'initech' },
      buildLocalEvalOptions(fields, lists),
    );
    expect(result.matched).toBe(false);
  });

  it('still fails closed with missing_list when the list is not loaded', () => {
    const result = evaluateCondition(rule, { vendor: 'acme' }, buildLocalEvalOptions(fields));
    expect(result.matched).toBe(false);
    expect(notes(result)).toContain('missing_list');
  });
});

describe('nested AND/OR groups', () => {
  const fields = [field('amount', 'number'), field('department', 'string'), field('urgent', 'boolean')];
  const rule = and(
    cmp('amount', '>', 50000),
    or(cmp('department', '=', 'Finance'), and(cmp('urgent', '=', true), cmp('amount', '>', 500000))),
  );

  it.each([
    [{ amount: 60000, department: 'Finance' }, true],
    [{ amount: 60000, department: 'Legal', urgent: true }, false],
    [{ amount: 600000, department: 'Legal', urgent: true }, true],
    [{ amount: 40000, department: 'Finance' }, false],
  ])('%j → %s', (payload, expected) => {
    expect(evaluateCondition(rule, payload, buildLocalEvalOptions(fields)).matched).toBe(expected);
  });
});

describe('missing fields', () => {
  const fields = [field('department', 'string')];

  it('fails the comparison with a missing_field note when no default is declared', () => {
    const result = evaluateCondition(
      cmp('department', '=', 'Finance'),
      {},
      buildLocalEvalOptions(fields),
    );
    expect(result.matched).toBe(false);
    expect(notes(result)).toContain('missing_field');
  });

  it('IS_NULL treats a missing field as null', () => {
    const result = evaluateCondition(cmp('department', 'IS_NULL'), {}, buildLocalEvalOptions(fields));
    expect(result.matched).toBe(true);
  });
});

describe('type coercion and mismatches', () => {
  it('coerces a string payload value for a registry-declared number field (API parity)', () => {
    const result = evaluateCondition(
      cmp('amount', '>', 100000),
      { amount: '200000' },
      buildLocalEvalOptions([field('amount', 'number')]),
    );
    expect(result.matched).toBe(true);
  });

  it('stays strict for unregistered fields: string vs number is a type_mismatch', () => {
    const result = evaluateCondition(cmp('custom.code', '=', '7'), { custom: { code: 7 } }, {});
    expect(result.matched).toBe(false);
    expect(notes(result)).toContain('type_mismatch');
  });
});

describe('parseTyped for custom (unregistered) paths', () => {
  it('stores numeric-looking values as numbers so they compare against JSON numbers', () => {
    expect(parseTyped('500', undefined)).toBe(500);
  });

  it('stores true/false as booleans', () => {
    expect(parseTyped('true', undefined)).toBe(true);
    expect(parseTyped('false', undefined)).toBe(false);
  });

  it('keeps non-numeric text as a string', () => {
    expect(parseTyped('acme', undefined)).toBe('acme');
  });

  it('keeps registered string fields as strings', () => {
    expect(parseTyped('500', 'string')).toBe('500');
  });

  it('a custom-path condition authored as "500" now matches a numeric payload', () => {
    const rule = cmp('custom.total', '>', parseTyped('500', undefined));
    expect(evaluateCondition(rule, { custom: { total: 750 } }, {}).matched).toBe(true);
  });
});
