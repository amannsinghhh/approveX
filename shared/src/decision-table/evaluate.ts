import { evaluateCondition } from '../rule-evaluator/evaluate';
import type { TraceEntry } from '../rule-evaluator/types';
import { compileRowToAst } from './compile';
import {
  DECISION_TABLE_REF_KEY,
  MAX_DECISION_TABLE_DEPTH,
  type DecisionTableDefinition,
  type DecisionTableError,
  type DecisionTableEvaluateOptions,
  type DecisionTableEvaluation,
  type DecisionTableRow,
  type RowEvaluation,
} from './types';

interface RowMatch {
  row: DecisionTableRow;
  rowIndex: number;
  matched: boolean;
  trace: TraceEntry[];
}

/**
 * Evaluates a payload against a decision table. Every row is always evaluated
 * (the grid UI shows all matches); `fired` reflects the hit policy:
 *   first  — the first matching row
 *   all    — every matching row
 *   unique — the sole matching row (a second match is a `unique_conflict`)
 *   best   — the highest-priority matching row
 *
 * A fired row whose output carries a `decisionTableRef` chains into that table
 * (resolved via options.resolveTable) and contributes the nested table's
 * outputs, up to MAX_DECISION_TABLE_DEPTH levels deep.
 */
export function evaluateDecisionTable(
  definition: DecisionTableDefinition,
  data: unknown,
  options: DecisionTableEvaluateOptions = {},
): DecisionTableEvaluation {
  return evaluateAtDepth(definition, data, options, 1);
}

function evaluateAtDepth(
  definition: DecisionTableDefinition,
  data: unknown,
  options: DecisionTableEvaluateOptions,
  depth: number,
): DecisionTableEvaluation {
  const errors: DecisionTableError[] = [];
  const maxDepth = options.maxDepth ?? MAX_DECISION_TABLE_DEPTH;

  // Pass 1: evaluate every row's match verdict (independent of hit policy).
  const matches: RowMatch[] = definition.rows.map((row, rowIndex) => {
    const ast = compileRowToAst(definition.columns, row.cells, options.fieldSchema);
    // A row of all-any cells (ast === null) matches everything.
    const evaluation = ast ? evaluateCondition(ast, data, options) : { matched: true, trace: [] };
    return { row, rowIndex, matched: evaluation.matched, trace: evaluation.trace };
  });

  // Decide which rows fire, per hit policy.
  const firedIndexes = selectFired(definition, matches, errors);

  // Pass 2: build per-row evaluations, resolving nested references on fired rows.
  const rows: RowEvaluation[] = matches.map((m) => {
    const fired = firedIndexes.has(m.rowIndex);
    const evaluation: RowEvaluation = {
      rowIndex: m.rowIndex,
      matched: m.matched,
      fired,
      output: m.row.output,
      trace: m.trace,
    };
    if (!fired) return evaluation;

    const ref = refOf(m.row.output);
    if (ref) {
      if (depth >= maxDepth) {
        errors.push({
          code: 'max_depth_exceeded',
          rowIndex: m.rowIndex,
          message: `Nested decision table "${ref}" exceeds the depth limit of ${maxDepth}`,
        });
      } else {
        const child = options.resolveTable?.(ref);
        if (!child) {
          errors.push({
            code: 'unresolved_ref',
            rowIndex: m.rowIndex,
            message: `Nested decision table "${ref}" could not be resolved`,
          });
        } else {
          evaluation.nested = evaluateAtDepth(child, data, options, depth + 1);
        }
      }
    }
    return evaluation;
  });

  // Collect outputs of fired rows, flattening nested-table outputs in place.
  const outputs: Record<string, unknown>[] = [];
  for (const row of rows) {
    if (!row.fired) continue;
    if (row.nested) {
      // A chaining row's own output is (mostly) the ref; emit any sibling
      // bindings it carries alongside, then the nested table's outputs.
      const own = withoutRef(row.output);
      if (Object.keys(own).length > 0) outputs.push(own);
      outputs.push(...row.nested.outputs);
      // Surface nested errors at the top level so callers see one flat list.
      if (row.nested.errors) errors.push(...row.nested.errors);
    } else {
      outputs.push(row.output);
    }
  }

  const result: DecisionTableEvaluation = {
    hitPolicy: definition.hitPolicy,
    rows,
    outputs,
    anyMatch: rows.some((row) => row.fired),
  };
  if (errors.length > 0) result.errors = errors;
  return result;
}

/** Chooses the firing rows for a hit policy from the matched set. */
function selectFired(
  definition: DecisionTableDefinition,
  matches: RowMatch[],
  errors: DecisionTableError[],
): Set<number> {
  const fired = new Set<number>();
  const matched = matches.filter((m) => m.matched);
  const first = matched[0];
  if (!first) return fired;

  switch (definition.hitPolicy) {
    case 'all':
      for (const m of matched) fired.add(m.rowIndex);
      return fired;

    case 'unique':
      fired.add(first.rowIndex);
      if (matched.length > 1) {
        errors.push({
          code: 'unique_conflict',
          message:
            `The "unique" hit policy matched ${matched.length} rows ` +
            `(${matched.map((m) => m.rowIndex).join(', ')}); rows must be mutually exclusive`,
        });
      }
      return fired;

    case 'best': {
      const best = matched.reduce((winner, candidate) => {
        const wp = winner.row.priority ?? 0;
        const cp = candidate.row.priority ?? 0;
        if (cp > wp) return candidate;
        if (cp < wp) return winner;
        // Tie: earlier row wins.
        return winner.rowIndex <= candidate.rowIndex ? winner : candidate;
      }, first);
      fired.add(best.rowIndex);
      return fired;
    }

    case 'first':
    default:
      fired.add(first.rowIndex);
      return fired;
  }
}

/** The nested-table name a row output chains to, or null if it does not chain. */
function refOf(output: Record<string, unknown>): string | null {
  const ref = output[DECISION_TABLE_REF_KEY];
  return typeof ref === 'string' && ref.length > 0 ? ref : null;
}

/** A copy of the output without the reserved chaining key. */
function withoutRef(output: Record<string, unknown>): Record<string, unknown> {
  const { [DECISION_TABLE_REF_KEY]: _ref, ...rest } = output;
  return rest;
}
