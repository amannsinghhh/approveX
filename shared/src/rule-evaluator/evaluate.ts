import {
  aggregateKey,
  isAggregateOperator,
  parseAggregateOperand,
  windowLabel,
} from './aggregates';
import {
  normalizeWeekday,
  parseClock,
  sameZonedDay,
  zonedParts,
} from './datetime';
import { resolvePath } from './path';
import { safeRegexTest } from './regex';
import {
  DEFAULT_TIMEZONE,
  fieldMetaOf,
  isLogicalNode,
} from './types';
import type {
  AggregateComparison,
  AggregateUsage,
  ComparisonNode,
  ConditionNode,
  EvaluateOptions,
  EvaluationResult,
  FieldMeta,
  FieldType,
  ListUsage,
  LookupUsage,
  TraceEntry,
  TraceNote,
} from './types';

const DAY_MS = 86_400_000;

/**
 * Evaluates a condition AST against a payload.
 *
 * Semantics (spec §5, addendum B.1–B.3):
 * - Missing fields make a comparison false (noted `missing_field`) — never throw
 *   — unless the field declares `defaultIfMissing`, in which case that value is
 *   substituted (`default_applied`). IS_NULL/IS_NOT_NULL and EXISTS/NOT_EXISTS
 *   answer presence directly. IS_EMPTY/IS_NOT_EMPTY treat missing as empty.
 * - No silent type coercion: a registered field is coerced to its declared type,
 *   otherwise operands must already match or the comparison is false with
 *   `type_mismatch` (even for `!=`).
 * - `valueType: "field"` compares against another payload field (cross-field);
 *   a missing referenced field yields `cross_field_missing`.
 * - Date/time operators resolve in the tenant timezone (EvalContext).
 * - Every node gets a trace entry; logical nodes never short-circuit, so the
 *   trace always shows the full green/red tree.
 */
export function evaluateCondition(
  node: ConditionNode,
  data: unknown,
  options: EvaluateOptions = {},
): EvaluationResult {
  const listsUsed: ListUsage[] = [];
  const aggregatesUsed: AggregateUsage[] = [];
  const lookupsUsed: LookupUsage[] = [];
  if (options.collectTrace === false) {
    const matched = visitFast(node, data, options, listsUsed, aggregatesUsed, lookupsUsed);
    return {
      matched,
      trace: [],
      aggregatesUsed: aggregatesUsed.length ? aggregatesUsed : undefined,
      listsUsed: listsUsed.length ? listsUsed : undefined,
      lookupsUsed: lookupsUsed.length ? lookupsUsed : undefined,
    };
  }
  const trace: TraceEntry[] = [];
  const matched = visit(node, data, 'root', options, trace, listsUsed, aggregatesUsed, lookupsUsed);
  return {
    matched,
    trace,
    aggregatesUsed: aggregatesUsed.length ? aggregatesUsed : undefined,
    listsUsed: listsUsed.length ? listsUsed : undefined,
    lookupsUsed: lookupsUsed.length ? lookupsUsed : undefined,
  };
}

/**
 * Trace-free evaluation for ranking large rule sets (Phase 7): identical
 * verdicts, but no trace allocation and logical short-circuiting is allowed —
 * evaluation is pure, so skipping doomed branches is unobservable.
 */
function visitFast(
  node: ConditionNode,
  data: unknown,
  options: EvaluateOptions,
  listsUsed: ListUsage[],
  aggregatesUsed: AggregateUsage[],
  lookupsUsed: LookupUsage[],
): boolean {
  if (isLogicalNode(node)) {
    if (node.operator === 'AND') {
      return node.children.every((child) =>
        visitFast(child, data, options, listsUsed, aggregatesUsed, lookupsUsed),
      );
    }
    if (node.operator === 'OR') {
      return node.children.some((child) =>
        visitFast(child, data, options, listsUsed, aggregatesUsed, lookupsUsed),
      );
    }
    const only = node.children[0];
    return only
      ? !visitFast(only, data, options, listsUsed, aggregatesUsed, lookupsUsed)
      : false;
  }
  return evaluateComparison(node, data, options, listsUsed, aggregatesUsed, lookupsUsed).result;
}

function visit(
  node: ConditionNode,
  data: unknown,
  path: string,
  options: EvaluateOptions,
  trace: TraceEntry[],
  listsUsed: ListUsage[],
  aggregatesUsed: AggregateUsage[],
  lookupsUsed: LookupUsage[],
): boolean {
  if (isLogicalNode(node)) {
    // Evaluate all children — the trace must show every branch.
    const results = node.children.map((child, index) =>
      visit(
        child,
        data,
        `${path}[${index}]`,
        options,
        trace,
        listsUsed,
        aggregatesUsed,
        lookupsUsed,
      ),
    );
    let result: boolean;
    if (node.operator === 'AND') result = results.every(Boolean);
    else if (node.operator === 'OR') result = results.some(Boolean);
    else result = !results[0]; // NOT — validated to exactly one child
    trace.push({ nodePath: path, operator: node.operator, result });
    return result;
  }
  const entry = evaluateComparison(node, data, options, listsUsed, aggregatesUsed, lookupsUsed);
  trace.push({ ...entry, nodePath: path });
  return entry.result;
}

type ComparisonOutcome = Omit<TraceEntry, 'nodePath'>;

/** Compares an injected aggregate value against the operand's threshold. */
function compareAggregate(op: AggregateComparison, value: number, threshold: number): boolean {
  switch (op) {
    case '>':
      return value > threshold;
    case '>=':
      return value >= threshold;
    case '<':
      return value < threshold;
    case '<=':
      return value <= threshold;
    case '=':
      return value === threshold;
    case '!=':
      return value !== threshold;
  }
}

function evaluateComparison(
  node: ComparisonNode,
  data: unknown,
  options: EvaluateOptions,
  listsUsed: ListUsage[],
  aggregatesUsed: AggregateUsage[],
  lookupsUsed: LookupUsage[],
): ComparisonOutcome {
  const notes: TraceNote[] = [];
  const schema = options.fieldSchema;
  const meta = fieldMetaOf(schema, node.field);
  const declaredType = meta?.type;
  if (schema && !meta) notes.push('unknown_field');

  let resolution = resolvePath(data, node.field);

  // B.3 #10 — looked_up fields never read the payload: the value must be
  // injected via options.lookups. A missing key fails the comparison closed
  // (`missing_lookup`); an unavailable lookup must never silently pass.
  if (meta?.source === 'looked_up') {
    const lookups = options.lookups;
    const found =
      lookups !== undefined && Object.prototype.hasOwnProperty.call(lookups, node.field);
    if (!lookupsUsed.some((entry) => entry.field === node.field)) {
      lookupsUsed.push(
        found
          ? { field: node.field, resolved: true, value: lookups?.[node.field] }
          : { field: node.field, resolved: false },
      );
    }
    if (!found) {
      notes.push('missing_lookup');
      return {
        operator: node.operator,
        field: node.field,
        expected: node.value,
        actual: undefined,
        result: false,
        notes,
      };
    }
    notes.push('lookup_applied');
    resolution = { found: true, value: lookups?.[node.field] };
  }

  const base: ComparisonOutcome = {
    operator: node.operator,
    field: node.field,
    expected: node.value,
    actual: resolution.found ? resolution.value : undefined,
    result: false,
    notes,
  };
  const done = (result: boolean): ComparisonOutcome => ({
    ...base,
    result,
    notes: notes.length ? notes : undefined,
  });
  const fail = (note?: TraceNote): ComparisonOutcome => {
    if (note) notes.push(note);
    return { ...base, result: false, notes: notes.length ? notes : undefined };
  };

  // Existence checks answer from raw presence — before defaults, never coerced.
  if (node.operator === 'EXISTS') return done(resolution.found);
  if (node.operator === 'NOT_EXISTS') return done(!resolution.found);

  // Null-ness operators answer directly; "missing" counts as null.
  if (node.operator === 'IS_NULL') {
    return done(!resolution.found || resolution.value === null);
  }
  if (node.operator === 'IS_NOT_NULL') {
    return done(resolution.found && resolution.value !== null);
  }

  // Resolve the working value, applying a declared missing-value default.
  let actual: unknown;
  if (resolution.found && resolution.value !== null) {
    actual = resolution.value;
  } else if (meta && meta.defaultIfMissing !== undefined) {
    actual = meta.defaultIfMissing;
    notes.push('default_applied');
    base.actual = actual;
  } else {
    actual = undefined;
  }

  // Emptiness operators treat missing/null as empty.
  if (node.operator === 'IS_EMPTY') return done(isEmptyValue(actual));
  if (node.operator === 'IS_NOT_EMPTY') return done(actual !== undefined && !isEmptyValue(actual));

  if (actual === undefined) return fail('missing_field');

  // Aggregate/lookback operators (B.3 #5): the value was computed by the
  // caller over history and injected under a canonical key. An absent key
  // fails closed (`missing_aggregate`) — never a silent pass.
  if (isAggregateOperator(node.operator)) {
    const operand = parseAggregateOperand(node.operator, node.value);
    if (!operand) return fail('invalid_operand');
    const key = aggregateKey(node.operator, node.field, actual, operand);
    const value = options.aggregates?.[key];
    if (typeof value !== 'number' || Number.isNaN(value)) return fail('missing_aggregate');
    base.actual = value; // the trace shows the aggregate, not the group key
    aggregatesUsed.push({
      type: node.operator === 'AGGREGATE_SUM_WITHIN' ? 'sum' : 'count',
      groupBy: node.field,
      window: windowLabel(operand.window),
      value,
    });
    return done(compareAggregate(operand.compare, value, operand.threshold));
  }

  // Resolve the comparison operand: literal, or a cross-field reference.
  let expected = node.value;
  if (node.valueType === 'field' && typeof node.value === 'string') {
    const ref = resolvePath(data, node.value);
    if (!ref.found || ref.value === null) return fail('cross_field_missing');
    expected = ref.value;
    base.expected = expected;
    base.expectedField = node.value;
    // Warn (don't fail) when both fields declare mismatched units.
    const refMeta = fieldMetaOf(schema, node.value);
    if (unitMismatch(meta, refMeta)) notes.push('unit_mismatch');
  }

  const ctx = options.context;
  const now = ctx?.now ?? Date.now();
  const timezone = ctx?.timezone ?? DEFAULT_TIMEZONE;

  switch (node.operator) {
    case '=': {
      const pair = coercePair(actual, expected, declaredType);
      if (!pair) return fail('type_mismatch');
      return done(valuesEqual(pair.actual, pair.expected));
    }
    case '!=': {
      const pair = coercePair(actual, expected, declaredType);
      // Spec: mismatched types = condition is false, even for !=
      if (!pair) return fail('type_mismatch');
      return done(!valuesEqual(pair.actual, pair.expected));
    }
    case '>':
    case '>=':
    case '<':
    case '<=': {
      const pair = coerceOrdered(actual, expected, declaredType);
      if (!pair) return fail('type_mismatch');
      const [a, b] = pair;
      if (node.operator === '>') return done(a > b);
      if (node.operator === '>=') return done(a >= b);
      if (node.operator === '<') return done(a < b);
      return done(a <= b);
    }
    case 'IN':
    case 'NOT_IN': {
      if (!Array.isArray(expected)) return fail('invalid_operand');
      const hit = expected.some((candidate) => {
        const pair = coercePair(actual, candidate, declaredType);
        return pair !== null && valuesEqual(pair.actual, pair.expected);
      });
      return done(node.operator === 'IN' ? hit : !hit);
    }
    case 'IN_IGNORE_CASE': {
      if (typeof actual !== 'string') return fail('type_mismatch');
      if (!Array.isArray(expected)) return fail('invalid_operand');
      const lower = actual.toLowerCase();
      return done(
        expected.some((v) => typeof v === 'string' && v.toLowerCase() === lower),
      );
    }
    case 'IN_LIST':
    case 'NOT_IN_LIST': {
      // The operand is the managed list's name; the list itself is injected via
      // options.managedLists. An absent list fails closed (never matches, either
      // direction) and is recorded so the trace shows why.
      if (typeof expected !== 'string' || expected.length === 0) return fail('invalid_operand');
      const list = options.managedLists?.[expected];
      if (!list) {
        listsUsed.push({ listName: expected, checkedValue: actual, found: false });
        return fail('missing_list');
      }
      const hit = list.some((candidate) => {
        const pair = coercePair(actual, candidate, declaredType);
        return pair !== null && valuesEqual(pair.actual, pair.expected);
      });
      listsUsed.push({ listName: expected, checkedValue: actual, found: hit });
      return done(node.operator === 'IN_LIST' ? hit : !hit);
    }
    case 'BETWEEN':
    case 'NOT_BETWEEN': {
      if (!Array.isArray(expected) || expected.length !== 2) return fail('invalid_operand');
      const low = coerceOrdered(actual, expected[0], declaredType);
      const high = coerceOrdered(actual, expected[1], declaredType);
      if (!low || !high) return fail('type_mismatch');
      const inside = low[0] >= low[1] && high[0] <= high[1];
      return done(node.operator === 'BETWEEN' ? inside : !inside);
    }
    case 'MULTIPLE_OF': {
      const a = toNumber(actual);
      const divisor = toNumber(expected);
      if (a === null || divisor === null) return fail('type_mismatch');
      if (divisor === 0) return fail('invalid_operand');
      return done(a % divisor === 0);
    }
    case 'WITHIN_PERCENT_OF': {
      const spec = expected as { percent?: unknown; of?: unknown } | null;
      if (!spec || typeof spec !== 'object') return fail('invalid_operand');
      const percent = toNumber(spec.percent);
      if (percent === null || typeof spec.of !== 'string') return fail('invalid_operand');
      const a = toNumber(actual);
      const ref = resolvePath(data, spec.of);
      const b = ref.found ? toNumber(ref.value) : null;
      if (a === null) return fail('type_mismatch');
      if (b === null) return fail('cross_field_missing');
      base.expected = b;
      base.expectedField = spec.of;
      return done(Math.abs(a - b) <= (percent / 100) * Math.abs(b));
    }
    case 'CONTAINS':
    case 'NOT_CONTAINS': {
      const has = valueContains(actual, expected);
      if (has === null) return fail('type_mismatch');
      return done(node.operator === 'CONTAINS' ? has : !has);
    }
    case 'CONTAINS_ALL':
    case 'CONTAINS_ANY': {
      if (!Array.isArray(actual) || !Array.isArray(expected)) return fail('type_mismatch');
      const present = (v: unknown): boolean => actual.some((item) => valuesEqual(item, v));
      return done(
        node.operator === 'CONTAINS_ALL' ? expected.every(present) : expected.some(present),
      );
    }
    case 'STARTS_WITH': {
      if (typeof actual !== 'string' || typeof expected !== 'string') return fail('type_mismatch');
      return done(actual.startsWith(expected));
    }
    case 'ENDS_WITH': {
      if (typeof actual !== 'string' || typeof expected !== 'string') return fail('type_mismatch');
      return done(actual.endsWith(expected));
    }
    case 'EQUALS_IGNORE_CASE': {
      if (typeof actual !== 'string' || typeof expected !== 'string') return fail('type_mismatch');
      return done(actual.toLowerCase() === expected.toLowerCase());
    }
    case 'MATCHES_REGEX': {
      if (typeof expected !== 'string') return fail('invalid_operand');
      if (typeof actual !== 'string') return fail('type_mismatch');
      const outcome = safeRegexTest(expected, actual, options.regexTimeoutMs);
      if (!outcome.ok) return fail(outcome.note);
      return done(outcome.result === true);
    }
    case 'LENGTH_EQ':
    case 'LENGTH_GT':
    case 'LENGTH_LT': {
      const length = lengthOf(actual);
      const target = toNumber(expected);
      if (length === null || target === null) return fail('type_mismatch');
      if (node.operator === 'LENGTH_EQ') return done(length === target);
      if (node.operator === 'LENGTH_GT') return done(length > target);
      return done(length < target);
    }
    case 'ANY_ITEM_MATCHES':
    case 'ALL_ITEMS_MATCH': {
      if (!Array.isArray(actual)) return fail('type_mismatch');
      if (!isConditionNode(expected)) return fail('invalid_operand');
      const sub = expected;
      const perItem = actual.map(
        (item) => evaluateCondition(sub, item, { ...options, collectTrace: false }).matched,
      );
      return done(node.operator === 'ANY_ITEM_MATCHES' ? perItem.some(Boolean) : perItem.every(Boolean));
    }
    case 'BEFORE':
    case 'AFTER':
    case 'ON': {
      const a = toTimestamp(actual);
      const b = toTimestamp(expected);
      if (a === null || b === null) return fail('type_mismatch');
      if (node.operator === 'BEFORE') return done(a < b);
      if (node.operator === 'AFTER') return done(a > b);
      return done(sameZonedDay(a, b, timezone));
    }
    case 'WITHIN_LAST_N_DAYS':
    case 'WITHIN_NEXT_N_DAYS':
    case 'OLDER_THAN_N_DAYS': {
      const a = toTimestamp(actual);
      const days = toNumber(expected);
      if (a === null) return fail('type_mismatch');
      if (days === null) return fail('invalid_operand');
      const span = days * DAY_MS;
      if (node.operator === 'WITHIN_LAST_N_DAYS') return done(a <= now && a >= now - span);
      if (node.operator === 'WITHIN_NEXT_N_DAYS') return done(a >= now && a <= now + span);
      return done(a < now - span);
    }
    case 'DAY_OF_WEEK_IN': {
      const a = toTimestamp(actual);
      if (a === null) return fail('type_mismatch');
      if (!Array.isArray(expected)) return fail('invalid_operand');
      const wanted = expected.map(normalizeWeekday);
      if (wanted.some((w) => w === null)) return fail('invalid_operand');
      return done(wanted.includes(zonedParts(a, timezone).weekday));
    }
    case 'TIME_OF_DAY_BETWEEN': {
      const a = toTimestamp(actual);
      if (a === null) return fail('type_mismatch');
      if (!Array.isArray(expected) || expected.length !== 2) return fail('invalid_operand');
      const start = parseClock(expected[0]);
      const end = parseClock(expected[1]);
      if (start === null || end === null) return fail('invalid_operand');
      const minutes = zonedParts(a, timezone).minutesOfDay;
      // start <= end is a normal window; start > end wraps past midnight.
      return done(start <= end ? minutes >= start && minutes <= end : minutes >= start || minutes <= end);
    }
    default:
      return fail('invalid_operand');
  }
}

// ------------------------------------------------------------------- helpers

function isEmptyValue(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return value.length === 0;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function lengthOf(value: unknown): number | null {
  if (Array.isArray(value)) return value.length;
  if (typeof value === 'string') return value.length;
  return null;
}

/** CONTAINS semantics for arrays (membership) and strings (substring). */
function valueContains(actual: unknown, expected: unknown): boolean | null {
  if (Array.isArray(actual)) return actual.some((item) => valuesEqual(item, expected));
  if (typeof actual === 'string' && typeof expected === 'string') return actual.includes(expected);
  return null;
}

function unitMismatch(a: FieldMeta | undefined, b: FieldMeta | undefined): boolean {
  return Boolean(a?.unit && b?.unit && a.unit !== b.unit);
}

function isConditionNode(value: unknown): value is ConditionNode {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { operator?: unknown }).operator === 'string'
  );
}

/**
 * Coerces both sides of an equality comparison. Returns null on an
 * unreconcilable type mismatch.
 */
function coercePair(
  actual: unknown,
  expected: unknown,
  declaredType: FieldType | undefined,
): { actual: unknown; expected: unknown } | null {
  if (declaredType === 'number') {
    const a = toNumber(actual);
    const b = toNumber(expected);
    if (a === null || b === null) return null;
    return { actual: a, expected: b };
  }
  if (declaredType === 'boolean') {
    if (typeof actual !== 'boolean' || typeof expected !== 'boolean') return null;
    return { actual, expected };
  }
  if (declaredType === 'date') {
    const a = toTimestamp(actual);
    const b = toTimestamp(expected);
    if (a === null || b === null) return null;
    return { actual: a, expected: b };
  }
  if (declaredType === 'string') {
    if (typeof actual !== 'string' || typeof expected !== 'string') return null;
    return { actual, expected };
  }
  // Unregistered field: strict — same primitive type or bust.
  if (typeof actual !== typeof expected) return null;
  return { actual, expected };
}

/** Coerces both sides of an ordered comparison into comparable primitives. */
function coerceOrdered(
  actual: unknown,
  expected: unknown,
  declaredType: FieldType | undefined,
): [number | string, number | string] | null {
  if (declaredType === 'number') {
    const a = toNumber(actual);
    const b = toNumber(expected);
    if (a === null || b === null) return null;
    return [a, b];
  }
  if (declaredType === 'date') {
    const a = toTimestamp(actual);
    const b = toTimestamp(expected);
    if (a === null || b === null) return null;
    return [a, b];
  }
  // No (or non-ordered) declared type: both numbers or both strings, strictly.
  if (typeof actual === 'number' && typeof expected === 'number') {
    if (Number.isNaN(actual) || Number.isNaN(expected)) return null;
    return [actual, expected];
  }
  if (typeof actual === 'string' && typeof expected === 'string') {
    return [actual, expected];
  }
  return null;
}

/** Internal (also used by the scoring evaluator, so both coerce identically). */
export function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isNaN(value) ? null : value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

function toTimestamp(value: unknown): number | null {
  if (typeof value === 'number') return Number.isNaN(value) ? null : value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

function valuesEqual(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => valuesEqual(item, b[index]));
  }
  return a === b;
}
