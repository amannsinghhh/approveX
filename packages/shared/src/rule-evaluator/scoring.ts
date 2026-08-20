/**
 * Scoring rules (B.3 #3) — the second rule type beside the condition tree.
 *
 * A scoring rule is a weighted sum: each factor reads one field, runs a scoring
 * function over it to produce a `score`, and contributes `weight × score` to a
 * total. The rule matches when the total clears the threshold. Every factor's
 * value, score and contribution lands in the trace's `scoreBreakdown`, so a
 * "risk score 72 ≥ 70" verdict is always explainable line by line.
 *
 * Like the condition evaluator this stays pure and browser-safe: no I/O, no
 * clock beyond the injected EvalContext.
 */
import { evaluateCondition, toNumber } from './evaluate';
import { resolvePath } from './path';
import { fieldMetaOf } from './types';
import type {
  ConditionNode,
  EvaluateOptions,
  EvaluationResult,
  FieldSchema,
  ScoreBreakdown,
  ScoreComparison,
  ScoreFactor,
  TraceEntry,
  TraceNote,
} from './types';
import { SCORE_COMPARISONS } from './types';
import { FIELD_PATTERN, validateConditionAst } from './validate';
import type { ValidationIssue, ValidationResult } from './validate';

export const SCORING_FUNCTION_TYPES = [
  'linear',
  'bands',
  'map',
  'boolean',
  'condition',
] as const;
export type ScoringFunctionType = (typeof SCORING_FUNCTION_TYPES)[number];

/** Normalizes a number onto 0..1 across [min, max]. `clamp: false` lets it run outside. */
export interface LinearScoring {
  type: 'linear';
  min: number;
  max: number;
  clamp?: boolean;
}
/** An inclusive upper bound and the score it awards; the last band omits `upTo` (catch-all). */
export interface ScoreBand {
  upTo?: number;
  score: number;
}
/** Ascending step function over a number — e.g. tiers of an amount. */
export interface BandsScoring {
  type: 'bands';
  bands: ScoreBand[];
}
/** Exact-value lookup for enum/string/boolean/number fields. */
export interface MapScoring {
  type: 'map';
  values: Record<string, number>;
  default?: number;
}
export interface BooleanScoring {
  type: 'boolean';
  whenTrue: number;
  whenFalse: number;
}
/** Scores on a full condition AST — the whole B.1 operator catalog, as a factor. */
export interface ConditionScoring {
  type: 'condition';
  condition: ConditionNode;
  whenTrue: number;
  whenFalse: number;
}
export type ScoringFunction =
  | LinearScoring
  | BandsScoring
  | MapScoring
  | BooleanScoring
  | ConditionScoring;

export interface ScoringFactor {
  /** The field the function scores. Required for every type except `condition`. */
  field?: string;
  /** Trace label; defaults to `field`, then to "factor N". */
  label?: string;
  /** Multiplies the function's score. Negative weights are mitigating factors. */
  weight: number;
  scoringFunction: ScoringFunction;
  /** Score awarded when the field is missing or unscoreable. Default 0. */
  missingScore?: number;
}

export interface ScoringSpec {
  factors: ScoringFactor[];
  threshold: number;
  /** Default '>=' — the total must reach the threshold to match. */
  operator?: ScoreComparison;
}

export const MAX_SCORING_FACTORS = 50;

// ------------------------------------------------------------------ evaluate

/**
 * Evaluates a scoring rule. Semantics mirror the condition evaluator: a missing
 * field never throws — it scores `missingScore` (default 0) with a
 * `missing_field` note, unless the registry declares `defaultIfMissing`.
 *
 * `collectTrace: false` returns the verdict alone (no trace, no breakdown) for
 * the ranking hot path; the verdict is identical either way.
 */
export function evaluateScoring(
  spec: ScoringSpec,
  data: unknown,
  options: EvaluateOptions = {},
): EvaluationResult {
  const traced = options.collectTrace !== false;
  const comparison = spec.operator ?? '>=';
  const factors: ScoreFactor[] = [];
  const nodes: TraceEntry[] = [];
  let total = 0;

  spec.factors.forEach((factor, index) => {
    const outcome = scoreFactor(factor, data, options);
    const contribution = round(factor.weight * outcome.score);
    total += contribution;
    if (!traced) return;

    const label = factor.label ?? factor.field ?? `factor ${index + 1}`;
    const notes = outcome.notes.length ? outcome.notes : undefined;
    factors.push({
      field: label,
      weight: factor.weight,
      score: outcome.score,
      contribution,
      value: outcome.value,
      notes,
    });
    nodes.push({
      nodePath: `factors[${index}]`,
      operator: `SCORE_${factor.scoringFunction.type.toUpperCase()}`,
      field: label,
      // The operand of a scoring factor is the function itself.
      expected: factor.scoringFunction,
      actual: outcome.value,
      // ✓ = the factor scored cleanly; ✗ = missing/unscoreable, so it fell back.
      result: outcome.ok,
      notes,
    });
  });

  total = round(total);
  const matched = compareScore(total, comparison, spec.threshold);
  if (!traced) return { matched, trace: [] };

  nodes.push({
    nodePath: 'root',
    operator: `SCORE ${comparison}`,
    expected: spec.threshold,
    actual: total,
    result: matched,
  });
  const scoreBreakdown: ScoreBreakdown = {
    total,
    threshold: spec.threshold,
    operator: comparison,
    factors,
  };
  return { matched, trace: nodes, scoreBreakdown };
}

interface FactorOutcome {
  score: number;
  value: unknown;
  notes: TraceNote[];
  /** False when the factor could not be scored and fell back to missingScore. */
  ok: boolean;
}

function scoreFactor(
  factor: ScoringFactor,
  data: unknown,
  options: EvaluateOptions,
): FactorOutcome {
  const fn = factor.scoringFunction;
  const notes: TraceNote[] = [];
  const fallback = (value: unknown, note: TraceNote): FactorOutcome => {
    notes.push(note);
    return { score: factor.missingScore ?? 0, value, notes, ok: false };
  };

  // A condition factor reads its own fields — nothing to resolve up front.
  if (fn.type === 'condition') {
    const { matched } = evaluateCondition(fn.condition, data, { ...options, collectTrace: false });
    return { score: matched ? fn.whenTrue : fn.whenFalse, value: matched, notes, ok: true };
  }

  const field = factor.field as string; // guaranteed by validateScoringSpec
  const meta = fieldMetaOf(options.fieldSchema, field);
  const resolution = resolvePath(data, field);

  // Mirrors the condition evaluator's coercion contract (coercePair/coerceOrdered):
  // numeric strings are coerced ONLY when the registry declares the field as a
  // number; an unregistered field must already hold a real number, or the factor
  // falls back with type_mismatch. No silent coercion (CLAUDE.md).
  const numericValue = (candidate: unknown): number | null => {
    if (meta?.type === 'number') return toNumber(candidate);
    return typeof candidate === 'number' && !Number.isNaN(candidate) ? candidate : null;
  };

  let value: unknown;
  if (resolution.found && resolution.value !== null) {
    value = resolution.value;
  } else if (meta && meta.defaultIfMissing !== undefined) {
    value = meta.defaultIfMissing;
    notes.push('default_applied');
  } else {
    return fallback(undefined, 'missing_field');
  }

  switch (fn.type) {
    case 'linear': {
      const n = numericValue(value);
      if (n === null) return fallback(value, 'type_mismatch');
      const raw = (n - fn.min) / (fn.max - fn.min); // max ≠ min enforced at validation
      const score = fn.clamp === false ? raw : Math.min(1, Math.max(0, raw));
      return { score: round(score), value, notes, ok: true };
    }
    case 'bands': {
      const n = numericValue(value);
      if (n === null) return fallback(value, 'type_mismatch');
      // Bands ascend and the last is open-ended, so one always matches.
      const band = fn.bands.find((b) => b.upTo === undefined || n <= b.upTo);
      if (!band) return fallback(value, 'invalid_operand');
      return { score: band.score, value, notes, ok: true };
    }
    case 'map': {
      const key = typeof value === 'string' ? value : String(value);
      if (Object.prototype.hasOwnProperty.call(fn.values, key)) {
        return { score: fn.values[key] as number, value, notes, ok: true };
      }
      if (fn.default !== undefined) return { score: fn.default, value, notes, ok: true };
      return fallback(value, 'unmapped_value');
    }
    case 'boolean': {
      if (typeof value !== 'boolean') return fallback(value, 'type_mismatch');
      return { score: value ? fn.whenTrue : fn.whenFalse, value, notes, ok: true };
    }
    default:
      return fallback(value, 'invalid_operand');
  }
}

function compareScore(total: number, operator: ScoreComparison, threshold: number): boolean {
  if (operator === '>=') return total >= threshold;
  if (operator === '>') return total > threshold;
  if (operator === '<=') return total <= threshold;
  return total < threshold;
}

/** Keeps float noise (0.1 × 3) out of the trace and the threshold comparison. */
function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

/** Factor count — the specificity measure for conflict resolution, as leaves are for trees. */
export function countScoringFactors(spec: ScoringSpec): number {
  return spec.factors.length;
}

// ------------------------------------------------------------------ validate

const isFinite_ = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/**
 * Structural validation of a scoring spec, called at rule create/publish time so
 * `evaluateScoring` can assume a well-formed spec (bands ascend and end open,
 * `linear` has a non-zero span, non-condition factors name a field).
 * With a `fieldSchema`, also checks each function against the field's type.
 */
export function validateScoringSpec(spec: unknown, fieldSchema?: FieldSchema): ValidationResult {
  const issues: ValidationIssue[] = [];
  const fail = (path: string, message: string): void => void issues.push({ path, message });

  if (spec === null || typeof spec !== 'object' || Array.isArray(spec)) {
    return { valid: false, issues: [{ path: 'root', message: 'Scoring spec must be an object' }] };
  }
  const record = spec as Record<string, unknown>;

  if (!isFinite_(record.threshold)) fail('root', 'Scoring spec requires a numeric threshold');
  if (
    record.operator !== undefined &&
    !(SCORE_COMPARISONS as readonly unknown[]).includes(record.operator)
  ) {
    fail('root', `operator must be one of ${SCORE_COMPARISONS.join(', ')}`);
  }

  const factors = record.factors;
  if (!Array.isArray(factors) || factors.length === 0) {
    fail('root', 'Scoring spec requires a non-empty factors array');
    return { valid: false, issues };
  }
  if (factors.length > MAX_SCORING_FACTORS) {
    fail('root', `Scoring spec exceeds the maximum of ${MAX_SCORING_FACTORS} factors`);
    return { valid: false, issues };
  }

  factors.forEach((candidate, index) => {
    const path = `factors[${index}]`;
    if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) {
      fail(path, 'Factor must be an object');
      return;
    }
    const factor = candidate as Record<string, unknown>;
    if (!isFinite_(factor.weight)) fail(path, 'Factor requires a numeric weight');
    if (factor.missingScore !== undefined && !isFinite_(factor.missingScore)) {
      fail(path, 'missingScore must be a number');
    }
    if (factor.label !== undefined && typeof factor.label !== 'string') {
      fail(path, 'label must be a string');
    }

    const fn = factor.scoringFunction;
    if (fn === null || typeof fn !== 'object' || Array.isArray(fn)) {
      fail(path, 'Factor requires a scoringFunction object');
      return;
    }
    const type = (fn as { type?: unknown }).type;
    if (typeof type !== 'string' || !(SCORING_FUNCTION_TYPES as readonly string[]).includes(type)) {
      fail(path, `Unknown scoring function "${String(type)}"`);
      return;
    }

    // Every function except `condition` scores one named field.
    let fieldType: string | undefined;
    if (type !== 'condition') {
      const field = factor.field;
      if (typeof field !== 'string' || !FIELD_PATTERN.test(field)) {
        fail(path, `A ${type} factor requires a valid field path`);
      } else {
        fieldType = fieldSchema ? fieldMetaOf(fieldSchema, field)?.type : undefined;
      }
    } else if (factor.field !== undefined) {
      fail(path, 'A condition factor scores its own condition — remove "field"');
    }

    validateScoringFunction(fn as Record<string, unknown>, type, fieldType, path, fieldSchema, fail);
  });

  return { valid: issues.length === 0, issues };
}

type Fail = (path: string, message: string) => void;

function validateScoringFunction(
  fn: Record<string, unknown>,
  type: string,
  fieldType: string | undefined,
  path: string,
  fieldSchema: FieldSchema | undefined,
  fail: Fail,
): void {
  const requireFieldType = (allowed: string[]): void => {
    if (fieldType && !allowed.includes(fieldType)) {
      fail(path, `A ${type} function is not valid for a ${fieldType} field`);
    }
  };

  switch (type) {
    case 'linear': {
      requireFieldType(['number']);
      if (!isFinite_(fn.min) || !isFinite_(fn.max)) {
        fail(path, 'linear requires numeric min and max');
      } else if (fn.min === fn.max) {
        fail(path, 'linear requires min ≠ max');
      }
      if (fn.clamp !== undefined && typeof fn.clamp !== 'boolean') {
        fail(path, 'linear clamp must be a boolean');
      }
      return;
    }
    case 'bands': {
      requireFieldType(['number']);
      const bands = fn.bands;
      if (!Array.isArray(bands) || bands.length === 0) {
        fail(path, 'bands requires a non-empty bands array');
        return;
      }
      let previous = -Infinity;
      bands.forEach((candidate, index) => {
        if (candidate === null || typeof candidate !== 'object') {
          fail(path, `bands[${index}] must be an object`);
          return;
        }
        const band = candidate as Record<string, unknown>;
        if (!isFinite_(band.score)) fail(path, `bands[${index}] requires a numeric score`);

        const last = index === bands.length - 1;
        if (last) {
          // The open-ended final band makes every value scoreable (fail closed).
          if (band.upTo !== undefined) fail(path, 'the last band must omit upTo (catch-all)');
          return;
        }
        if (!isFinite_(band.upTo)) {
          fail(path, `bands[${index}] requires a numeric upTo`);
          return;
        }
        if (band.upTo <= previous) fail(path, 'band upTo values must ascend');
        previous = band.upTo;
      });
      return;
    }
    case 'map': {
      requireFieldType(['string', 'number', 'boolean']);
      const values = fn.values;
      if (values === null || typeof values !== 'object' || Array.isArray(values)) {
        fail(path, 'map requires a values object');
        return;
      }
      const entries = Object.entries(values as Record<string, unknown>);
      if (entries.length === 0) fail(path, 'map requires at least one value');
      for (const [key, score] of entries) {
        if (!isFinite_(score)) fail(path, `map value "${key}" must be a number`);
      }
      if (fn.default !== undefined && !isFinite_(fn.default)) {
        fail(path, 'map default must be a number');
      }
      return;
    }
    case 'boolean': {
      requireFieldType(['boolean']);
      if (!isFinite_(fn.whenTrue) || !isFinite_(fn.whenFalse)) {
        fail(path, 'boolean requires numeric whenTrue and whenFalse');
      }
      return;
    }
    case 'condition': {
      if (!isFinite_(fn.whenTrue) || !isFinite_(fn.whenFalse)) {
        fail(path, 'condition requires numeric whenTrue and whenFalse');
      }
      const nested = validateConditionAst(fn.condition, fieldSchema);
      for (const issue of nested.issues) {
        fail(`${path}.condition`, issue.message);
      }
      return;
    }
    default:
      return;
  }
}
