import { describe, expect, it } from 'vitest';
import {
  compileRowToAst,
  evaluateDecisionTable,
  parseCell,
  validateDecisionTable,
} from '../../shared/src/decision-table';
import type { DecisionTableDefinition } from '../../shared/src/decision-table';
import type { FieldSchema } from '../../shared/src/rule-evaluator/types';

const schema: FieldSchema = { amount: 'number', department: 'string', urgent: 'boolean' };

describe('parseCell', () => {
  it.each([
    ['*', undefined, null],
    ['', undefined, null],
    ['  ', undefined, null],
    ['> 500000', 'number', { operator: '>', value: 500000 }],
    ['>=10', 'number', { operator: '>=', value: 10 }],
    ['< 50000', 'number', { operator: '<', value: 50000 }],
    ['!= 5', 'number', { operator: '!=', value: 5 }],
    ['50000..500000', 'number', { operator: 'BETWEEN', value: [50000, 500000] }],
    ['Finance', 'string', { operator: '=', value: 'Finance' }],
    ['Finance, Procurement', 'string', { operator: 'IN', value: ['Finance', 'Procurement'] }],
    ['true', 'boolean', { operator: '=', value: true }],
    ['42', undefined, { operator: '=', value: 42 }], // untyped: looks numeric
    ['"42"', undefined, { operator: '=', value: '42' }], // quoted stays string
    ['@VIPCustomers', 'string', { operator: 'IN_LIST', value: 'VIPCustomers' }],
    ['!@Blocklist', 'string', { operator: 'NOT_IN_LIST', value: 'Blocklist' }],
    ['@ List With Spaces ', 'string', { operator: 'IN_LIST', value: 'List With Spaces' }],
  ] as const)('parses %j (%s)', (raw, type, expected) => {
    expect(parseCell(raw, type)).toEqual(expected);
  });

  it('rejects an empty managed-list name', () => {
    expect(() => parseCell('@   ', 'string')).toThrow();
  });

  it.each([
    ['abc', 'number'],
    ['> abc', 'number'],
    ['yes', 'boolean'],
    ['not-a-date', 'date'],
  ] as const)('rejects %j for type %s', (raw, type) => {
    expect(() => parseCell(raw, type)).toThrow();
  });
});

describe('compileRowToAst', () => {
  const columns = [{ field: 'amount' }, { field: 'department' }];

  it('ANDs all non-any cells', () => {
    expect(compileRowToAst(columns, ['50000..500000', 'Finance'], schema)).toEqual({
      operator: 'AND',
      children: [
        { field: 'amount', operator: 'BETWEEN', value: [50000, 500000] },
        { field: 'department', operator: '=', value: 'Finance' },
      ],
    });
  });

  it('single condition rows compile to a bare comparison', () => {
    expect(compileRowToAst(columns, ['> 500000', '*'], schema)).toEqual({
      field: 'amount',
      operator: '>',
      value: 500000,
    });
  });

  it('all-any rows compile to null (match everything)', () => {
    expect(compileRowToAst(columns, ['*', ''], schema)).toBeNull();
  });
});

describe('evaluateDecisionTable', () => {
  // The spec's example table
  const table: DecisionTableDefinition = {
    hitPolicy: 'first',
    columns: [{ field: 'amount' }, { field: 'department' }],
    rows: [
      { cells: ['< 50000', '*'], output: { workflow: 'MANAGER_ONLY' } },
      { cells: ['50000..500000', 'Finance'], output: { workflow: 'MANAGER_FINANCE' } },
      { cells: ['> 500000', '*'], output: { workflow: 'MANAGER_FINANCE_CFO' } },
    ],
  };

  it.each([
    [{ amount: 10000, department: 'HR' }, 'MANAGER_ONLY'],
    [{ amount: 200000, department: 'Finance' }, 'MANAGER_FINANCE'],
    [{ amount: 900000, department: 'HR' }, 'MANAGER_FINANCE_CFO'],
  ])('%j → %s', (data, workflow) => {
    const result = evaluateDecisionTable(table, data, { fieldSchema: schema });
    expect(result.anyMatch).toBe(true);
    expect(result.outputs).toEqual([{ workflow }]);
  });

  it('no row matches → anyMatch false', () => {
    const result = evaluateDecisionTable(
      table,
      { amount: 200000, department: 'HR' },
      { fieldSchema: schema },
    );
    expect(result.anyMatch).toBe(false);
    expect(result.outputs).toEqual([]);
  });

  it('hit policy first: only the first matching row fires, but all rows are traced', () => {
    const overlapping: DecisionTableDefinition = {
      hitPolicy: 'first',
      columns: [{ field: 'amount' }],
      rows: [
        { cells: ['> 100'], output: { workflow: 'A' } },
        { cells: ['> 10'], output: { workflow: 'B' } },
      ],
    };
    const result = evaluateDecisionTable(overlapping, { amount: 500 }, { fieldSchema: schema });
    expect(result.rows.map((row) => row.matched)).toEqual([true, true]);
    expect(result.rows.map((row) => row.fired)).toEqual([true, false]);
    expect(result.outputs).toEqual([{ workflow: 'A' }]);
  });

  it('hit policy all: every matching row fires', () => {
    const overlapping: DecisionTableDefinition = {
      hitPolicy: 'all',
      columns: [{ field: 'amount' }],
      rows: [
        { cells: ['> 100'], output: { workflow: 'A' } },
        { cells: ['> 10'], output: { workflow: 'B' } },
        { cells: ['< 5'], output: { workflow: 'C' } },
      ],
    };
    const result = evaluateDecisionTable(overlapping, { amount: 500 }, { fieldSchema: schema });
    expect(result.outputs).toEqual([{ workflow: 'A' }, { workflow: 'B' }]);
  });

  it('registry coercion applies inside cells (numeric string payload)', () => {
    const result = evaluateDecisionTable(
      table,
      { amount: '200000', department: 'Finance' },
      { fieldSchema: schema },
    );
    expect(result.outputs).toEqual([{ workflow: 'MANAGER_FINANCE' }]);
  });

  it('missing fields make rows not match, never throw', () => {
    const result = evaluateDecisionTable(table, {}, { fieldSchema: schema });
    expect(result.anyMatch).toBe(false);
    expect(result.rows[0]?.trace[0]?.notes).toContain('missing_field');
  });
});

describe('validateDecisionTable', () => {
  const valid: DecisionTableDefinition = {
    hitPolicy: 'first',
    columns: [{ field: 'amount' }],
    rows: [{ cells: ['> 10'], output: { workflow: 'X' } }],
  };

  it('accepts a valid table', () => {
    expect(validateDecisionTable(valid, schema)).toEqual({ valid: true, issues: [] });
  });

  it.each([
    [{ ...valid, hitPolicy: 'bogus' }, 'hitPolicy'],
    [{ ...valid, columns: [] }, 'At least one column'],
    [{ ...valid, columns: [{ field: '1 bad' }] }, 'valid field path'],
    [{ ...valid, rows: [] }, 'At least one row'],
    [{ ...valid, rows: [{ cells: ['> 10', 'extra'], output: {} }] }, '2 cells but the table has 1'],
    [{ ...valid, rows: [{ cells: ['> 10'] }] }, 'output object'],
  ] as [unknown, string][])('rejects %j', (definition, fragment) => {
    const result = validateDecisionTable(definition, schema);
    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.message).join(' | ')).toContain(fragment);
  });

  it('rejects unparseable cells with the offending position', () => {
    const result = validateDecisionTable(
      { ...valid, rows: [{ cells: ['> abc'], output: {} }] },
      schema,
    );
    expect(result.valid).toBe(false);
    expect(result.issues[0]?.path).toBe('rows[0].cells[0]');
  });

  it('rejects a non-numeric priority', () => {
    const result = validateDecisionTable(
      { ...valid, hitPolicy: 'best', rows: [{ cells: ['> 10'], output: {}, priority: 'high' }] },
      schema,
    );
    expect(result.valid).toBe(false);
    expect(result.issues[0]?.path).toBe('rows[0].priority');
  });

  it('rejects an empty/non-string nested-table reference', () => {
    const result = validateDecisionTable(
      { ...valid, rows: [{ cells: ['> 10'], output: { decisionTableRef: '' } }] },
      schema,
    );
    expect(result.valid).toBe(false);
    expect(result.issues.map((i) => i.message).join(' | ')).toContain('nested decision-table reference');
  });

  it('accepts a chaining row whose only output is a nested reference', () => {
    const result = validateDecisionTable(
      { ...valid, outputs: ['workflow'], rows: [{ cells: ['> 10'], output: { decisionTableRef: 'Tier2' } }] },
      schema,
    );
    expect(result).toEqual({ valid: true, issues: [] });
  });

  it('flags missing and unexpected keys against declared outputs', () => {
    const result = validateDecisionTable(
      {
        ...valid,
        outputs: ['workflow'],
        rows: [{ cells: ['> 10'], output: { approver: 'X' } }],
      },
      schema,
    );
    expect(result.valid).toBe(false);
    const messages = result.issues.map((i) => i.message).join(' | ');
    expect(messages).toContain('Unexpected output key "approver"');
    expect(messages).toContain('Missing output key "workflow"');
  });

  it('rejects overlapping rows under the unique policy', () => {
    const result = validateDecisionTable(
      {
        hitPolicy: 'unique',
        columns: [{ field: 'amount' }],
        rows: [
          { cells: ['> 100'], output: { workflow: 'A' } },
          { cells: ['> 500'], output: { workflow: 'B' } },
        ],
      },
      schema,
    );
    expect(result.valid).toBe(false);
    expect(result.issues.map((i) => i.message).join(' | ')).toContain('overlap');
  });

  it('accepts provably-disjoint rows under the unique policy', () => {
    const result = validateDecisionTable(
      {
        hitPolicy: 'unique',
        columns: [{ field: 'amount' }],
        rows: [
          { cells: ['< 100'], output: { workflow: 'A' } },
          { cells: ['> 500'], output: { workflow: 'B' } },
        ],
      },
      schema,
    );
    expect(result).toEqual({ valid: true, issues: [] });
  });
});
