/**
 * Comparison operators, grouped by the field type they apply to (B.1). The flat
 * COMPARISON_OPERATORS union is the source of truth for validation; the
 * per-type buckets in operators.ts drive the Rule Builder's operator dropdown.
 *
 * Value shapes by operator (all carried on ComparisonNode.value):
 *   scalar (= != > >= < <= BEFORE AFTER ON): a literal, or a field path when
 *     valueType is "field" (cross-field comparison, B.3 #4)
 *   BETWEEN / NOT_BETWEEN:        [low, high]
 *   IN / NOT_IN / IN_IGNORE_CASE: value[]
 *   IN_LIST / NOT_IN_LIST:        the managed list's name (string), resolved
 *     against EvaluateOptions.managedLists — absent list fails closed
 *   CONTAINS_ALL / CONTAINS_ANY:  value[]
 *   MULTIPLE_OF:                  number (divisor)
 *   WITHIN_PERCENT_OF:            { percent: number, of: <field path> }
 *   LENGTH_EQ / LENGTH_GT / LENGTH_LT: number
 *   WITHIN_LAST_N_DAYS / WITHIN_NEXT_N_DAYS / OLDER_THAN_N_DAYS: number (days)
 *   DAY_OF_WEEK_IN:               (number 0-6 | day-name)[]
 *   TIME_OF_DAY_BETWEEN:          ["HH:MM", "HH:MM"]
 *   ANY_ITEM_MATCHES / ALL_ITEMS_MATCH: a nested ConditionNode (per array item)
 *   EQUALS_IGNORE_CASE / CONTAINS / NOT_CONTAINS / STARTS_WITH / ENDS_WITH /
 *     MATCHES_REGEX: a string
 *   AGGREGATE_COUNT_WITHIN / AGGREGATE_SUM_WITHIN: an AggregateOperand —
 *     { window, compare, threshold, sumField? }; the value is injected via
 *     EvaluateOptions.aggregates, absent value fails closed
 *   IS_NULL / IS_NOT_NULL / IS_EMPTY / IS_NOT_EMPTY / EXISTS / NOT_EXISTS: none
 */
export const COMPARISON_OPERATORS = [
  // equality / ordering
  '=',
  '!=',
  '>',
  '>=',
  '<',
  '<=',
  // membership
  'IN',
  'NOT_IN',
  'IN_IGNORE_CASE',
  // managed-list membership (list resolved by name at evaluate time)
  'IN_LIST',
  'NOT_IN_LIST',
  // ranges
  'BETWEEN',
  'NOT_BETWEEN',
  // numeric
  'MULTIPLE_OF',
  'WITHIN_PERCENT_OF',
  // text
  'CONTAINS',
  'NOT_CONTAINS',
  'STARTS_WITH',
  'ENDS_WITH',
  'MATCHES_REGEX',
  'EQUALS_IGNORE_CASE',
  'IS_EMPTY',
  'IS_NOT_EMPTY',
  // date / time (evaluated in the tenant timezone — see EvalContext)
  'BEFORE',
  'AFTER',
  'ON',
  'WITHIN_LAST_N_DAYS',
  'WITHIN_NEXT_N_DAYS',
  'OLDER_THAN_N_DAYS',
  'DAY_OF_WEEK_IN',
  'TIME_OF_DAY_BETWEEN',
  // array
  'CONTAINS_ALL',
  'CONTAINS_ANY',
  'LENGTH_EQ',
  'LENGTH_GT',
  'LENGTH_LT',
  'ANY_ITEM_MATCHES',
  'ALL_ITEMS_MATCH',
  // aggregate / lookback (B.3 #5, Phase 6) — computed over request history by
  // the caller and injected via EvaluateOptions.aggregates; evaluator stays pure
  'AGGREGATE_COUNT_WITHIN',
  'AGGREGATE_SUM_WITHIN',
  // null / existence
  'IS_NULL',
  'IS_NOT_NULL',
  'EXISTS',
  'NOT_EXISTS',
] as const;
export type ComparisonOperator = (typeof COMPARISON_OPERATORS)[number];

export const LOGICAL_OPERATORS = ['AND', 'OR', 'NOT'] as const;
export type LogicalOperator = (typeof LOGICAL_OPERATORS)[number];

/** How to read ComparisonNode.value: a literal, or a dot-path to another field. */
export type ValueType = 'literal' | 'field';

export interface ComparisonNode {
  field: string;
  operator: ComparisonOperator;
  value?: unknown;
  /**
   * "literal" (default) compares against value as-is. "field" treats value as a
   * dot-path resolved against the same payload (cross-field comparison, B.3 #4)
   * — only meaningful for scalar operators.
   */
  valueType?: ValueType;
}

export interface LogicalNode {
  operator: LogicalOperator;
  children: ConditionNode[];
}

export type ConditionNode = ComparisonNode | LogicalNode;

export const FIELD_TYPES = ['number', 'string', 'boolean', 'date'] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

/** Where a field's value comes from at evaluate time (B.2). */
export const FIELD_SOURCES = ['payload', 'computed', 'looked_up'] as const;
export type FieldSource = (typeof FIELD_SOURCES)[number];

/**
 * P0.1 Request Portal: how a user-submittable field renders on the generated
 * request form. Independent of the storage `FieldType` — e.g. a `number` field
 * can render as `currency`, a `string` as `select` or `textarea`. `file` is a
 * placeholder for the deferred attachments slice.
 */
export const FIELD_INPUT_TYPES = [
  'text',
  'number',
  'currency',
  'date',
  'select',
  'textarea',
  'checkbox',
  'file',
] as const;
export type FieldInputType = (typeof FIELD_INPUT_TYPES)[number];

/**
 * What the API does when an external lookup fails or times out (B.3 #10).
 * `treat_as_no_match` — inject nothing; the evaluator fails the comparison
 * closed (`missing_lookup`). `use_cached_value` — fall back to the last
 * successfully fetched value (Redis); if none exists, behaves like
 * treat_as_no_match. `block_and_alert` — refuse to evaluate and raise an
 * alert; never a silent pass.
 */
export const LOOKUP_FALLBACK_BEHAVIORS = [
  'treat_as_no_match',
  'use_cached_value',
  'block_and_alert',
] as const;
export type LookupFallbackBehavior = (typeof LOOKUP_FALLBACK_BEHAVIORS)[number];

/**
 * Registry metadata for one field (B.2). Beyond the base type, declares unit,
 * precision, nullability, a missing-value default, provenance, and (for enums)
 * the allowed values. Currency fields are stored as integers in minor units
 * (paise/cents) — precision records the number of minor digits, never a float.
 */
export interface FieldMeta {
  type: FieldType;
  /** e.g. "currency:INR", "weight:kg", "duration:hours". */
  unit?: string;
  /** Minor-unit digits for numeric/currency fields (INR paise = 2). */
  precision?: number;
  nullable?: boolean;
  /** What a missing field is treated as, instead of auto-failing the comparison. */
  defaultIfMissing?: unknown;
  source?: FieldSource;
  /** Allowed values for an enum-style string field. */
  enumValues?: string[];
  /**
   * B.3 #10 — for `source: looked_up` fields only: the outbound HTTP endpoint
   * the API resolves the value from, and what to do when that call fails.
   * Ignored by the (pure, browser-safe) evaluator, which only ever reads the
   * pre-resolved value from EvaluateOptions.lookups.
   */
  lookupUrl?: string;
  lookupFallback?: LookupFallbackBehavior;
}

/**
 * Per-tenant field registry snapshot. Back-compatible: an entry may be a bare
 * FieldType string (legacy/cache) or the richer FieldMeta object. Use
 * fieldMetaOf / fieldTypeOf to read either shape.
 */
export type FieldEntry = FieldType | FieldMeta;
export type FieldSchema = Record<string, FieldEntry>;

/** Normalizes a registry entry (string or object) to FieldMeta. */
export function fieldMetaOf(
  schema: FieldSchema | undefined,
  field: string,
): FieldMeta | undefined {
  const entry = schema?.[field];
  if (entry === undefined) return undefined;
  return typeof entry === 'string' ? { type: entry } : entry;
}

/** Declared type of a field, reading either registry shape. */
export function fieldTypeOf(
  schema: FieldSchema | undefined,
  field: string,
): FieldType | undefined {
  return fieldMetaOf(schema, field)?.type;
}

export type TraceNote =
  | 'missing_field'
  | 'unknown_field'
  | 'type_mismatch'
  | 'invalid_operand'
  | 'invalid_regex'
  | 'unsafe_regex'
  | 'regex_timeout'
  | 'input_too_long'
  | 'default_applied'
  | 'unit_mismatch'
  | 'cross_field_missing'
  | 'unmapped_value'
  | 'missing_list'
  | 'missing_aggregate'
  | 'missing_lookup'
  | 'lookup_applied';

export interface TraceEntry {
  /** Position in the tree, e.g. "root", "root[0]", "root[2][1]". */
  nodePath: string;
  /** "AND" / "OR" / "NOT" or the comparison operator. */
  operator: string;
  result: boolean;
  field?: string;
  expected?: unknown;
  actual?: unknown;
  /** For cross-field comparisons: the dot-path the expected value came from. */
  expectedField?: string;
  notes?: TraceNote[];
}

/** Comparisons an aggregate operand may apply to the computed value (B.3 #5). */
export const AGGREGATE_COMPARISONS = ['>', '>=', '<', '<=', '=', '!='] as const;
export type AggregateComparison = (typeof AGGREGATE_COMPARISONS)[number];

/**
 * Lookback window for aggregate operators. `rolling` reaches back N days from
 * EvalContext.now; `fiscal_year_to_date` starts at the tenant's fiscal year
 * start (EvalContext.fiscalYearStartMonth, default April — test scenario 22).
 */
export type AggregateWindow =
  | { kind: 'rolling'; days: number }
  | { kind: 'fiscal_year_to_date' };

/**
 * Operand of AGGREGATE_COUNT_WITHIN / AGGREGATE_SUM_WITHIN. The node's `field`
 * is the grouping key: the aggregate is computed over history rows sharing the
 * payload's value of that field (e.g. requests by vendor_id) inside `window`,
 * then checked as `aggregate <compare> threshold`. SUM additionally names the
 * numeric history field it totals via `sumField`.
 */
export interface AggregateOperand {
  window: AggregateWindow;
  compare: AggregateComparison;
  threshold: number;
  sumField?: string;
}

/**
 * Forward-looking trace facets (B.5). Aggregate/list/score usage is populated
 * from Phase 6 / scoring rules; in the base condition-tree evaluator these stay
 * undefined, but the shape is fixed now so the response format is stable.
 */
export interface AggregateUsage {
  type: string;
  groupBy?: string;
  window?: string;
  value: number;
}
export interface ListUsage {
  listName: string;
  checkedValue: unknown;
  found: boolean;
}
/** How a scoring rule's total is compared with its threshold. */
export const SCORE_COMPARISONS = ['>=', '>', '<=', '<'] as const;
export type ScoreComparison = (typeof SCORE_COMPARISONS)[number];

export interface ScoreFactor {
  /** The factor's label — its field, or an explicit label for condition factors. */
  field: string;
  weight: number;
  /** Raw output of the scoring function, before weighting. */
  score: number;
  /** weight × score — what this factor added to the total. */
  contribution: number;
  /** The field value the function scored (the match verdict, for condition factors). */
  value?: unknown;
  notes?: TraceNote[];
}
export interface ScoreBreakdown {
  total: number;
  threshold: number;
  operator: ScoreComparison;
  factors: ScoreFactor[];
}

/** One looked_up field the evaluation touched (B.3 #10, B.5 facet). */
export interface LookupUsage {
  field: string;
  /** true when the API injected a resolved value; false = failed closed. */
  resolved: boolean;
  value?: unknown;
}

export interface EvaluationResult {
  matched: boolean;
  trace: TraceEntry[];
  /** B.5 facets — undefined for a plain condition tree; set by scoring/aggregate rules. */
  aggregatesUsed?: AggregateUsage[];
  listsUsed?: ListUsage[];
  lookupsUsed?: LookupUsage[];
  scoreBreakdown?: ScoreBreakdown | null;
}

/** How a rule reached its verdict — future: 'decision_table'. */
export type RuleTraceType = 'condition_tree' | 'scoring';

/**
 * Structured evaluation trace for the API response (B.5). Wraps the leaf nodes
 * with the overall result and the facets (aggregate/list/score usage) so every
 * non-obvious thing the engine did is visible, not just leaf pass/fail.
 */
export interface StructuredTrace {
  type: RuleTraceType;
  result: boolean;
  nodes: TraceEntry[];
  aggregatesUsed?: AggregateUsage[];
  listsUsed?: ListUsage[];
  lookupsUsed?: LookupUsage[];
  scoreBreakdown?: ScoreBreakdown | null;
}

/** Wraps an EvaluationResult in the B.5 structured-trace shape. */
export function toStructuredTrace(
  result: EvaluationResult,
  type: RuleTraceType = 'condition_tree',
): StructuredTrace {
  return {
    type,
    result: result.matched,
    nodes: result.trace,
    aggregatesUsed: result.aggregatesUsed,
    listsUsed: result.listsUsed,
    lookupsUsed: result.lookupsUsed,
    scoreBreakdown: result.scoreBreakdown ?? null,
  };
}

/**
 * Temporal / locale context for date and time operators (B.2). Comparisons are
 * anchored to `now` and rendered in `timezone`; `fiscalYearStartMonth` supports
 * fiscal-year-scoped aggregates (Phase 6). Defaults: now = Date.now(),
 * timezone = Asia/Kolkata, fiscal year starts in April.
 */
export interface EvalContext {
  now?: number;
  timezone?: string;
  fiscalYearStartMonth?: number;
}

export const DEFAULT_TIMEZONE = 'Asia/Kolkata';
export const DEFAULT_FISCAL_YEAR_START_MONTH = 4;

export interface EvaluateOptions {
  /** Registry snapshot used for explicit type coercion and missing-field defaults. */
  fieldSchema?: FieldSchema;
  /** Hard cap on MATCHES_REGEX execution (Node only). Default 25ms. */
  regexTimeoutMs?: number;
  /** Temporal/locale context for date-and-time operators. */
  context?: EvalContext;
  /**
   * Named value lists available to IN_LIST / NOT_IN_LIST, keyed by list name.
   * A referenced list that is absent here fails the comparison closed (never
   * matches, either direction) and is noted `missing_list` — an unavailable
   * list must never silently pass. Injected by the caller from the tenant's
   * managed-list store (see rule-cache).
   */
  managedLists?: Record<string, readonly unknown[]>;
  /**
   * Pre-computed aggregate values for the AGGREGATE_* operators, keyed by
   * aggregateKey(). Callers collect the keys a rule needs for a payload with
   * collectAggregateRefs(), compute them over history (Phase 6 provider), and
   * inject them here. A referenced key that is absent fails the comparison
   * closed and is noted `missing_aggregate` — an unavailable aggregate must
   * never silently pass.
   */
  aggregates?: Record<string, number>;
  /**
   * Pre-resolved values for `source: looked_up` fields (B.3 #10), keyed by
   * field path. The API fetches these (outbound HTTP + Redis cache) before
   * evaluating; the evaluator only reads them. A looked_up field with no entry
   * here fails the comparison closed (`missing_lookup`) — an unavailable
   * lookup must never silently pass. Fallback behavior (`treat_as_no_match` /
   * `use_cached_value` / `block_and_alert`) is applied by the caller when
   * building this map.
   */
  lookups?: Record<string, unknown>;
  /**
   * false = fast ranking path: no trace entries are allocated and logical
   * nodes MAY short-circuit. The matched verdict is identical — evaluation is
   * side-effect free. Default true (full trace, no short-circuit).
   */
  collectTrace?: boolean;
}

/** Legal payload field paths (dot + [index]) — shared by validate and aggregates. */
export const FIELD_PATTERN =
  /^[A-Za-z_][A-Za-z0-9_]*(\[\d+\])*(\.[A-Za-z_][A-Za-z0-9_]*(\[\d+\])*)*$/;

export const MAX_AST_DEPTH = 10;
export const MAX_AST_NODES = 200;

export function isLogicalNode(node: ConditionNode): node is LogicalNode {
  return (
    typeof node === 'object' &&
    node !== null &&
    'children' in node &&
    (LOGICAL_OPERATORS as readonly string[]).includes((node as LogicalNode).operator)
  );
}
