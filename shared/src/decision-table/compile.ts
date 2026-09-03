import type { ComparisonNode, ConditionNode, FieldSchema } from '../rule-evaluator/types';
import { fieldTypeOf } from '../rule-evaluator/types';
import { FIELD_PATTERN, type ValidationIssue } from '../rule-evaluator/validate';
import { detectOverlaps } from './overlap';
import type { CellFieldType, DecisionTableDefinition } from './types';
import { DECISION_TABLE_REF_KEY, EXCLUSIVE_HIT_POLICIES, HIT_POLICIES } from './types';

export class CellParseError extends Error {}

const COMPARISON_PREFIX = /^(>=|<=|!=|>|<|=)\s*(.+)$/;
const RANGE = /^(.+?)\.\.(.+)$/;

/** Parses a literal according to the column's declared type (registry-driven). */
function parseLiteral(raw: string, type: CellFieldType): unknown {
  const trimmed = raw.trim();
  // Quoted strings are always strings, e.g. "42" stays "42"
  const quoted = trimmed.match(/^(["'])(.*)\1$/);
  if (quoted) return quoted[2];

  if (type === 'number') {
    const value = Number(trimmed);
    if (trimmed === '' || Number.isNaN(value)) {
      throw new CellParseError(`"${raw}" is not a number`);
    }
    return value;
  }
  if (type === 'boolean') {
    if (trimmed === 'true') return true;
    if (trimmed === 'false') return false;
    throw new CellParseError(`"${raw}" is not true/false`);
  }
  if (type === 'date') {
    if (Number.isNaN(Date.parse(trimmed))) {
      throw new CellParseError(`"${raw}" is not a date`);
    }
    return trimmed;
  }
  // Untyped columns: numbers look like numbers, booleans like booleans.
  if (trimmed !== '' && !Number.isNaN(Number(trimmed))) return Number(trimmed);
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  return trimmed;
}

/**
 * Parses one grid cell into a comparison (minus the field), or null for "any".
 * Throws CellParseError with a human-readable reason on bad input.
 */
export function parseCell(
  raw: string,
  type: CellFieldType,
): Pick<ComparisonNode, 'operator' | 'value'> | null {
  const cell = raw.trim();
  if (cell === '' || cell === '*') return null;

  // Managed-list membership: "@ListName" (IN_LIST), "!@ListName" (NOT_IN_LIST).
  const listRef = cell.match(/^(!?)@(.*)$/);
  if (listRef) {
    const name = (listRef[2] ?? '').trim();
    if (name === '') throw new CellParseError('Empty managed list name');
    return { operator: listRef[1] === '!' ? 'NOT_IN_LIST' : 'IN_LIST', value: name };
  }

  const comparison = cell.match(COMPARISON_PREFIX);
  if (comparison) {
    const operator = comparison[1] as ComparisonNode['operator'];
    return { operator, value: parseLiteral(comparison[2] ?? '', type) };
  }

  const range = cell.match(RANGE);
  if (range) {
    return {
      operator: 'BETWEEN',
      value: [parseLiteral(range[1] ?? '', type), parseLiteral(range[2] ?? '', type)],
    };
  }

  if (cell.includes(',')) {
    return {
      operator: 'IN',
      value: cell.split(',').map((part) => parseLiteral(part, type)),
    };
  }

  return { operator: '=', value: parseLiteral(cell, type) };
}

/**
 * Compiles a row to the shared condition AST — AND of all non-any cells.
 * Returns null when every cell is "any" (the row matches everything).
 */
export function compileRowToAst(
  columns: DecisionTableDefinition['columns'],
  cells: string[],
  fieldSchema?: FieldSchema,
): ConditionNode | null {
  const comparisons: ComparisonNode[] = [];
  columns.forEach((column, index) => {
    const parsed = parseCell(cells[index] ?? '', fieldTypeOf(fieldSchema, column.field));
    if (parsed) comparisons.push({ field: column.field, ...parsed });
  });
  if (comparisons.length === 0) return null;
  if (comparisons.length === 1) return comparisons[0] ?? null;
  return { operator: 'AND', children: comparisons };
}

/** Structural validation for authoring/publish time. */
export function validateDecisionTable(
  definition: unknown,
  fieldSchema?: FieldSchema,
): { valid: boolean; issues: ValidationIssue[] } {
  const issues: ValidationIssue[] = [];
  const push = (path: string, message: string): void => {
    issues.push({ path, message });
  };

  if (definition === null || typeof definition !== 'object') {
    return { valid: false, issues: [{ path: 'root', message: 'Definition must be an object' }] };
  }
  const def = definition as Partial<DecisionTableDefinition>;

  if (!HIT_POLICIES.includes(def.hitPolicy as never)) {
    push('hitPolicy', 'hitPolicy must be "first" or "all"');
  }

  if (!Array.isArray(def.columns) || def.columns.length === 0) {
    push('columns', 'At least one column is required');
  } else {
    def.columns.forEach((column, index) => {
      if (!column || typeof column.field !== 'string' || !FIELD_PATTERN.test(column.field)) {
        push(`columns[${index}]`, 'Column needs a valid field path');
      }
    });
  }

  if (!Array.isArray(def.rows) || def.rows.length === 0) {
    push('rows', 'At least one row is required');
  } else if (Array.isArray(def.columns)) {
    def.rows.forEach((row, rowIndex) => {
      if (!row || !Array.isArray(row.cells)) {
        push(`rows[${rowIndex}]`, 'Row needs a cells array');
        return;
      }
      if (row.cells.length !== def.columns!.length) {
        push(
          `rows[${rowIndex}]`,
          `Row has ${row.cells.length} cells but the table has ${def.columns!.length} columns`,
        );
        return;
      }
      if (row.output === null || typeof row.output !== 'object' || Array.isArray(row.output)) {
        push(`rows[${rowIndex}].output`, 'Row needs an output object');
      } else {
        const output = row.output as Record<string, unknown>;
        const ref = output[DECISION_TABLE_REF_KEY];
        if (ref !== undefined && (typeof ref !== 'string' || ref.length === 0)) {
          push(
            `rows[${rowIndex}].output.${DECISION_TABLE_REF_KEY}`,
            'A nested decision-table reference must be a non-empty string',
          );
        }
        // When output keys are declared, a non-chaining row must bind exactly them.
        if (Array.isArray(def.outputs) && ref === undefined) {
          const declared = new Set(def.outputs);
          const keys = Object.keys(output);
          for (const key of keys) {
            if (!declared.has(key)) push(`rows[${rowIndex}].output.${key}`, `Unexpected output key "${key}"`);
          }
          for (const key of def.outputs) {
            if (!(key in output)) push(`rows[${rowIndex}].output`, `Missing output key "${key}"`);
          }
        }
      }
      if (row.priority !== undefined && (typeof row.priority !== 'number' || Number.isNaN(row.priority))) {
        push(`rows[${rowIndex}].priority`, 'priority must be a number');
      }
      row.cells.forEach((cell, cellIndex) => {
        if (typeof cell !== 'string') {
          push(`rows[${rowIndex}].cells[${cellIndex}]`, 'Cells must be strings');
          return;
        }
        const column = def.columns![cellIndex];
        try {
          parseCell(cell, column ? fieldTypeOf(fieldSchema, column.field) : undefined);
        } catch (err) {
          push(
            `rows[${rowIndex}].cells[${cellIndex}]`,
            err instanceof Error ? err.message : 'Unparseable cell',
          );
        }
      });
    });
  }

  // For exclusive hit policies, overlapping rows make the outcome ambiguous.
  // Only run once the structure is otherwise sound so detectOverlaps sees clean rows.
  if (
    issues.length === 0 &&
    EXCLUSIVE_HIT_POLICIES.includes(def.hitPolicy as never) &&
    Array.isArray(def.columns) &&
    Array.isArray(def.rows)
  ) {
    for (const { a, b } of detectOverlaps(def as DecisionTableDefinition, fieldSchema)) {
      push('rows', `Rows ${a} and ${b} overlap, which is ambiguous under the "${def.hitPolicy}" policy`);
    }
  }

  return { valid: issues.length === 0, issues };
}
