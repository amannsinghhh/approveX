/**
 * Aggregate/lookback operators (B.3 #5, Phase 6). The evaluator stays pure:
 * aggregate values are computed by the caller over request history and
 * injected through EvaluateOptions.aggregates, keyed by aggregateKey(). This
 * module owns the operand guard, the canonical key (the evaluator↔provider
 * contract), and the pre-scan the provider uses to learn which aggregates a
 * rule needs for a given payload.
 */
import { zonedParts } from './datetime';
import { resolvePath } from './path';
import type {
  AggregateOperand,
  AggregateWindow,
  ConditionNode,
  EvalContext,
  FieldSchema,
} from './types';
import {
  AGGREGATE_COMPARISONS,
  DEFAULT_FISCAL_YEAR_START_MONTH,
  DEFAULT_TIMEZONE,
  FIELD_PATTERN,
  fieldMetaOf,
  isLogicalNode,
} from './types';

export type AggregateOperator = 'AGGREGATE_COUNT_WITHIN' | 'AGGREGATE_SUM_WITHIN';

export function isAggregateOperator(operator: string): operator is AggregateOperator {
  return operator === 'AGGREGATE_COUNT_WITHIN' || operator === 'AGGREGATE_SUM_WITHIN';
}

/** Lookback ceiling for rolling windows: ten years. */
export const MAX_AGGREGATE_WINDOW_DAYS = 3650;

/** Canonical label for a window — embedded in the cache key ("30d", "fytd"). */
export function windowLabel(window: AggregateWindow): string {
  return window.kind === 'rolling' ? `${window.days}d` : 'fytd';
}

/**
 * Structural problems with an aggregate operand, as human-readable messages.
 * Shared by publish-time validation (validate.ts) and the runtime guard so the
 * two can never drift. Empty array ⇒ well-formed.
 */
export function aggregateOperandIssues(operator: AggregateOperator, value: unknown): string[] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return [`${operator} requires an operand object { window, compare, threshold }`];
  }
  const issues: string[] = [];
  const operand = value as Record<string, unknown>;
  const window = operand.window as Record<string, unknown> | null | undefined;
  if (!window || typeof window !== 'object' || Array.isArray(window)) {
    issues.push('window must be { kind: "rolling", days } or { kind: "fiscal_year_to_date" }');
  } else if (window.kind === 'rolling') {
    const days = window.days;
    if (
      typeof days !== 'number' ||
      !Number.isInteger(days) ||
      days < 1 ||
      days > MAX_AGGREGATE_WINDOW_DAYS
    ) {
      issues.push(`rolling window needs integer days between 1 and ${MAX_AGGREGATE_WINDOW_DAYS}`);
    }
  } else if (window.kind !== 'fiscal_year_to_date') {
    issues.push('window.kind must be "rolling" or "fiscal_year_to_date"');
  }
  if (!(AGGREGATE_COMPARISONS as readonly unknown[]).includes(operand.compare)) {
    issues.push(`compare must be one of ${AGGREGATE_COMPARISONS.join(', ')}`);
  }
  if (typeof operand.threshold !== 'number' || Number.isNaN(operand.threshold)) {
    issues.push('threshold must be a number');
  }
  if (operator === 'AGGREGATE_SUM_WITHIN') {
    if (typeof operand.sumField !== 'string' || !FIELD_PATTERN.test(operand.sumField)) {
      issues.push('AGGREGATE_SUM_WITHIN needs a valid sumField path (the history field to sum)');
    }
  } else if (operand.sumField !== undefined) {
    issues.push('sumField is only valid on AGGREGATE_SUM_WITHIN');
  }
  return issues;
}

/** Runtime guard: the well-formed operand, or undefined (→ `invalid_operand`). */
export function parseAggregateOperand(
  operator: AggregateOperator,
  value: unknown,
): AggregateOperand | undefined {
  return aggregateOperandIssues(operator, value).length === 0
    ? (value as AggregateOperand)
    : undefined;
}

/**
 * Canonical key an injected aggregate is stored under — the contract between
 * the evaluator and the provider/cache (M5-CP2):
 *   agg:count:<window>:<field>=<group>           e.g. agg:count:30d:vendor_id=V42
 *   agg:sum:<sumField>:<window>:<field>=<group>  e.g. agg:sum:amount:fytd:requester_id=U7
 */
export function aggregateKey(
  operator: AggregateOperator,
  field: string,
  groupValue: unknown,
  operand: AggregateOperand,
): string {
  const group = typeof groupValue === 'string' ? groupValue : JSON.stringify(groupValue);
  const win = windowLabel(operand.window);
  return operator === 'AGGREGATE_SUM_WITHIN'
    ? `agg:sum:${operand.sumField}:${win}:${field}=${group}`
    : `agg:count:${win}:${field}=${group}`;
}

/** One aggregate a rule needs for a payload — what the provider must compute. */
export interface AggregateRef {
  key: string;
  kind: 'count' | 'sum';
  /** Grouping field (the comparison node's field). */
  field: string;
  /** The payload's value of that field — the group being aggregated. */
  groupValue: unknown;
  window: AggregateWindow;
  sumField?: string;
}

/**
 * Pre-scan: every aggregate the AST would look up for this payload, deduped by
 * key. Mirrors the evaluator's field resolution (including defaultIfMissing
 * when `fieldSchema` is given). Nodes whose group value is missing are skipped
 * — the evaluator fails those closed as `missing_field` without a lookup —
 * and malformed operands are skipped too (`invalid_operand` at evaluate time).
 * Aggregates nested under ANY_ITEM_MATCHES / ALL_ITEMS_MATCH are intentionally
 * not collected: their sub-conditions resolve against array items, not the
 * root payload, and are unsupported for aggregates (they fail closed).
 */
export function collectAggregateRefs(
  node: ConditionNode,
  payload: unknown,
  fieldSchema?: FieldSchema,
): AggregateRef[] {
  const byKey = new Map<string, AggregateRef>();
  walk(node, payload, fieldSchema, byKey);
  return [...byKey.values()];
}

function walk(
  node: ConditionNode,
  payload: unknown,
  fieldSchema: FieldSchema | undefined,
  byKey: Map<string, AggregateRef>,
): void {
  if (isLogicalNode(node)) {
    for (const child of node.children) walk(child, payload, fieldSchema, byKey);
    return;
  }
  if (!isAggregateOperator(node.operator)) return;
  const operand = parseAggregateOperand(node.operator, node.value);
  if (!operand) return;

  // Same resolution order as the evaluator: payload value, else declared default.
  const resolution = resolvePath(payload, node.field);
  let groupValue: unknown;
  if (resolution.found && resolution.value !== null) {
    groupValue = resolution.value;
  } else {
    const fallback = fieldMetaOf(fieldSchema, node.field)?.defaultIfMissing;
    if (fallback === undefined) return;
    groupValue = fallback;
  }

  const key = aggregateKey(node.operator, node.field, groupValue, operand);
  if (byKey.has(key)) return;
  byKey.set(key, {
    key,
    kind: node.operator === 'AGGREGATE_SUM_WITHIN' ? 'sum' : 'count',
    field: node.field,
    groupValue,
    window: operand.window,
    sumField: operand.sumField,
  });
}

const DAY_MS = 86_400_000;

/**
 * Epoch ms where a window's history begins — the provider↔evaluator boundary
 * (M5-CP2). Rolling windows reach back N days from `context.now`; fiscal-year
 * windows start at local midnight on the 1st of the tenant's fiscal start
 * month (test scenario 22: April 1 by default, in the tenant timezone).
 */
export function windowStartMs(window: AggregateWindow, context?: EvalContext): number {
  const now = context?.now ?? Date.now();
  if (window.kind === 'rolling') return now - window.days * DAY_MS;

  const timezone = context?.timezone ?? DEFAULT_TIMEZONE;
  const startMonth = context?.fiscalYearStartMonth ?? DEFAULT_FISCAL_YEAR_START_MONTH;
  const today = zonedParts(now, timezone);
  const fiscalYear = today.month >= startMonth ? today.year : today.year - 1;
  return zonedMidnightUtc(fiscalYear, startMonth, timezone);
}

/**
 * Epoch ms of local midnight on (year, month, 1) in the timezone. Iterative
 * inverse of zonedParts: start from the UTC instant of that wall-clock time
 * and correct by the observed difference (converges in one step for fixed
 * offsets, two around DST transitions).
 */
function zonedMidnightUtc(year: number, month: number, timezone: string): number {
  const targetWallClock = Date.UTC(year, month - 1, 1);
  let guess = targetWallClock;
  for (let i = 0; i < 3; i += 1) {
    const parts = zonedParts(guess, timezone);
    const observedWallClock = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      Math.floor(parts.minutesOfDay / 60),
      parts.minutesOfDay % 60,
    );
    const diff = targetWallClock - observedWallClock;
    if (diff === 0) return guess;
    guess += diff;
  }
  return guess;
}
