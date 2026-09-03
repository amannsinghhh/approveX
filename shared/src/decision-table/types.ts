import type { EvaluateOptions, FieldType, TraceEntry } from '../rule-evaluator/types';

/**
 * Hit policies (addendum C):
 *   first  — fire only the first matching row, in row order.
 *   all    — fire every matching row.
 *   unique — at most one row may match. Overlapping rows are a publish-time
 *            error (see detectOverlaps); if two rows still match at evaluate
 *            time it is reported as a `unique_conflict` and only the first
 *            match fires, so evaluation stays deterministic.
 *   best   — fire the single highest-priority matching row (row.priority, higher
 *            wins; ties break by row order). Overlaps are allowed — priority
 *            resolves them.
 */
export const HIT_POLICIES = ['first', 'all', 'unique', 'best'] as const;
export type HitPolicy = (typeof HIT_POLICIES)[number];

/** Policies that require rows to be mutually exclusive (enforced at publish). */
export const EXCLUSIVE_HIT_POLICIES: readonly HitPolicy[] = ['unique'];

export interface DecisionTableColumn {
  /** Dot-path field name, same rules as condition ASTs. */
  field: string;
  /** Optional label for the grid header; defaults to the field name. */
  label?: string;
}

/**
 * Reserved output key: when a fired row's output carries a non-empty string
 * under this key, the engine chains into the named decision table (a nested
 * reference, depth-capped by MAX_DECISION_TABLE_DEPTH) and merges that table's
 * outputs in. The key itself is never emitted as an output binding.
 */
export const DECISION_TABLE_REF_KEY = 'decisionTableRef';

/** Maximum decision-table nesting depth (the top-level table is depth 1). */
export const MAX_DECISION_TABLE_DEPTH = 3;

/** A row's output payload: named bindings, optionally chaining to another table. */
export type DecisionTableOutput = Record<string, unknown>;

export interface DecisionTableRow {
  /**
   * One cell per column, in column order. Cell grammar:
   *   "*" or ""          any (no condition)
   *   "> 500000"         comparison (=, !=, >, >=, <, <=)
   *   "50000..500000"    inclusive BETWEEN
   *   "Finance, Procurement"  IN list
   *   "@VIPCustomers"    IN_LIST — membership in the named managed list
   *   "!@Blocklist"      NOT_IN_LIST
   *   "Finance"          equality
   */
  cells: string[];
  /** Output payload; Phase 4 resolves `workflow` keys to bindings. */
  output: DecisionTableOutput;
  /**
   * "best" hit policy only: higher priority wins, default 0; ties break by row
   * order. Ignored by the other policies.
   */
  priority?: number;
}

export interface DecisionTableDefinition {
  columns: DecisionTableColumn[];
  rows: DecisionTableRow[];
  hitPolicy: HitPolicy;
  /**
   * Declared output keys, for the editor and multi-output validation. Optional
   * and advisory — when present, publish-time validation checks every row's
   * output binds exactly these keys (the ref key aside).
   */
  outputs?: string[];
}

/**
 * Resolves a nested `decisionTableRef` to its definition. Returns undefined for
 * an unknown name; the evaluator then records an `unresolved_ref` error rather
 * than throwing.
 */
export type DecisionTableResolver = (name: string) => DecisionTableDefinition | undefined;

export interface DecisionTableEvaluateOptions extends EvaluateOptions {
  /** Resolves nested decision-table references (chaining). */
  resolveTable?: DecisionTableResolver;
  /** Nesting depth cap; defaults to MAX_DECISION_TABLE_DEPTH. */
  maxDepth?: number;
}

export interface RowEvaluation {
  rowIndex: number;
  /** Did the row's conditions match the payload? */
  matched: boolean;
  /** Did the row produce output under the table's hit policy? */
  fired: boolean;
  output: Record<string, unknown>;
  trace: TraceEntry[];
  /** Set when a fired row chained into a nested decision table. */
  nested?: DecisionTableEvaluation;
}

export type DecisionTableErrorCode =
  | 'unique_conflict'
  | 'unresolved_ref'
  | 'max_depth_exceeded';

export interface DecisionTableError {
  code: DecisionTableErrorCode;
  message: string;
  /** The row that triggered the error, when applicable. */
  rowIndex?: number;
}

export interface DecisionTableEvaluation {
  hitPolicy: HitPolicy;
  rows: RowEvaluation[];
  /** Outputs of fired rows, nested-table outputs flattened in, in row order. */
  outputs: Record<string, unknown>[];
  anyMatch: boolean;
  /** Non-fatal evaluation problems: unique conflicts, unresolved/too-deep refs. */
  errors?: DecisionTableError[];
}

export type CellFieldType = FieldType | undefined;
