import { toNumber } from '../rule-evaluator/evaluate';
import { fieldTypeOf } from '../rule-evaluator/types';
import type { FieldSchema } from '../rule-evaluator/types';
import { parseCell } from './compile';
import type { CellFieldType, DecisionTableDefinition } from './types';

/** A pair of row indexes whose conditions can be satisfied by the same payload. */
export interface OverlapPair {
  a: number;
  b: number;
}

/**
 * A single cell reduced to a constraint over its column's value domain:
 *   any      — no condition (matches everything)
 *   points   — value ∈ a finite set ("=", IN)
 *   interval — value within a (possibly half-open) ordered range (BETWEEN, <, > …)
 *   exclude  — value ≠ one point ("!=")
 * Managed-list membership (IN_LIST / NOT_IN_LIST) is not statically known, so it
 * normalizes to `any` — conservatively compatible with everything.
 */
type Norm =
  | { kind: 'any' }
  | { kind: 'points'; values: unknown[] }
  | { kind: 'interval'; lo: MaybeBound; hi: MaybeBound }
  | { kind: 'exclude'; value: unknown };

interface Bound {
  value: number | string;
  inclusive: boolean;
}
/** null bound = unbounded in that direction (±∞). */
type MaybeBound = Bound | null;

/**
 * Finds every pair of rows that is *not provably disjoint* — i.e. the pairs a
 * "unique" table must not contain. The analysis is sound for disjointness: it
 * only rules a pair out when it can prove the two rows can never match the same
 * payload, so it never hides a real overlap (it may conservatively report a
 * pair it cannot decide, e.g. managed-list cells).
 */
export function detectOverlaps(
  definition: Pick<DecisionTableDefinition, 'columns' | 'rows'>,
  fieldSchema?: FieldSchema,
): OverlapPair[] {
  const columns = definition.columns ?? [];
  const rows = definition.rows ?? [];
  const types: CellFieldType[] = columns.map((col) => fieldTypeOf(fieldSchema, col.field));

  const norms: Norm[][] = rows.map((row) =>
    columns.map((_col, index) => normalizeCell(row.cells?.[index] ?? '', types[index])),
  );

  const pairs: OverlapPair[] = [];
  for (let i = 0; i < rows.length; i += 1) {
    for (let j = i + 1; j < rows.length; j += 1) {
      if (rowsOverlap(norms[i] ?? [], norms[j] ?? [], types)) pairs.push({ a: i, b: j });
    }
  }
  return pairs;
}

/** Two rows overlap unless some column proves them disjoint. */
function rowsOverlap(a: Norm[], b: Norm[], types: CellFieldType[]): boolean {
  for (let c = 0; c < types.length; c += 1) {
    const na = a[c] ?? { kind: 'any' };
    const nb = b[c] ?? { kind: 'any' };
    if (columnDisjoint(na, nb, types[c])) return false;
  }
  return true;
}

function normalizeCell(raw: string, type: CellFieldType): Norm {
  let parsed: ReturnType<typeof parseCell>;
  try {
    parsed = parseCell(raw, type);
  } catch {
    // Unparseable cells are caught by validation elsewhere; treat as any here.
    return { kind: 'any' };
  }
  if (!parsed) return { kind: 'any' };
  const { operator, value } = parsed;
  switch (operator) {
    case '=':
      return { kind: 'points', values: [value] };
    case 'IN':
      return Array.isArray(value) ? { kind: 'points', values: value } : { kind: 'any' };
    case '!=':
      return { kind: 'exclude', value };
    case 'BETWEEN': {
      if (!Array.isArray(value) || value.length !== 2) return { kind: 'any' };
      const lo = ord(value[0], type);
      const hi = ord(value[1], type);
      if (lo === null || hi === null) return { kind: 'any' };
      return { kind: 'interval', lo: { value: lo, inclusive: true }, hi: { value: hi, inclusive: true } };
    }
    case '>':
    case '>=': {
      const b = ord(value, type);
      return b === null
        ? { kind: 'any' }
        : { kind: 'interval', lo: { value: b, inclusive: operator === '>=' }, hi: null };
    }
    case '<':
    case '<=': {
      const b = ord(value, type);
      return b === null
        ? { kind: 'any' }
        : { kind: 'interval', lo: null, hi: { value: b, inclusive: operator === '<=' } };
    }
    default:
      // IN_LIST / NOT_IN_LIST — membership is not statically known.
      return { kind: 'any' };
  }
}

/** True only when the two cell constraints can never hold for the same value. */
function columnDisjoint(a: Norm, b: Norm, type: CellFieldType): boolean {
  if (a.kind === 'any' || b.kind === 'any') return false;

  if (a.kind === 'exclude' || b.kind === 'exclude') {
    const ex = a.kind === 'exclude' ? a : (b as Norm & { kind: 'exclude' });
    const other = a.kind === 'exclude' ? b : a;
    return excludeDisjoint(ex.value, other, type);
  }
  if (a.kind === 'points' && b.kind === 'points') {
    return !a.values.some((x) => b.values.some((y) => eqVal(x, y, type)));
  }
  if (a.kind === 'points' && b.kind === 'interval') return pointsIntervalDisjoint(a.values, b, type);
  if (a.kind === 'interval' && b.kind === 'points') return pointsIntervalDisjoint(b.values, a, type);
  if (a.kind === 'interval' && b.kind === 'interval') return intervalsDisjoint(a, b);
  return false;
}

/** "≠ excluded" against another constraint: disjoint only when nothing else survives. */
function excludeDisjoint(excluded: unknown, other: Norm, type: CellFieldType): boolean {
  if (other.kind === 'points') return other.values.every((v) => eqVal(v, excluded, type));
  if (other.kind === 'interval') {
    // A range minus one point is empty only if the range is exactly that point.
    const e = ord(excluded, type);
    return (
      other.lo !== null &&
      other.hi !== null &&
      other.lo.inclusive &&
      other.hi.inclusive &&
      e !== null &&
      cmp(other.lo.value, other.hi.value) === 0 &&
      cmp(other.lo.value, e) === 0
    );
  }
  return false; // exclude vs exclude — always jointly satisfiable
}

function pointsIntervalDisjoint(points: unknown[], interval: Norm & { kind: 'interval' }, type: CellFieldType): boolean {
  return points.every((p) => {
    const op = ord(p, type);
    if (op === null) return false; // unorderable point — cannot prove it is outside
    return !inInterval(op, interval);
  });
}

function inInterval(v: number | string, iv: Norm & { kind: 'interval' }): boolean {
  if (iv.lo !== null) {
    const c = cmp(v, iv.lo.value);
    if (Number.isNaN(c) || c < 0) return Number.isNaN(c); // incomparable ⇒ assume inside
    if (c === 0 && !iv.lo.inclusive) return false;
  }
  if (iv.hi !== null) {
    const c = cmp(v, iv.hi.value);
    if (Number.isNaN(c)) return true;
    if (c > 0) return false;
    if (c === 0 && !iv.hi.inclusive) return false;
  }
  return true;
}

function intervalsDisjoint(a: Norm & { kind: 'interval' }, b: Norm & { kind: 'interval' }): boolean {
  const lo = tighterLow(a.lo, b.lo);
  const hi = tighterHigh(a.hi, b.hi);
  if (lo === null || hi === null) return false; // one side unbounded ⇒ room to overlap
  const c = cmp(lo.value, hi.value);
  if (Number.isNaN(c)) return false;
  if (c > 0) return true;
  if (c === 0 && !(lo.inclusive && hi.inclusive)) return true;
  return false;
}

/** The greater (tighter) lower bound; null means −∞. */
function tighterLow(x: MaybeBound, y: MaybeBound): MaybeBound {
  if (!x) return y;
  if (!y) return x;
  const c = cmp(x.value, y.value);
  if (Number.isNaN(c) || c > 0) return x;
  if (c < 0) return y;
  return { value: x.value, inclusive: x.inclusive && y.inclusive };
}

/** The lesser (tighter) upper bound; null means +∞. */
function tighterHigh(x: MaybeBound, y: MaybeBound): MaybeBound {
  if (!x) return y;
  if (!y) return x;
  const c = cmp(x.value, y.value);
  if (Number.isNaN(c) || c < 0) return x;
  if (c > 0) return y;
  return { value: x.value, inclusive: x.inclusive && y.inclusive };
}

/** Orders a raw cell value into a comparable primitive for its column type. */
function ord(v: unknown, type: CellFieldType): number | string | null {
  if (type === 'date') {
    if (typeof v === 'number') return Number.isNaN(v) ? null : v;
    if (typeof v === 'string') {
      const t = Date.parse(v);
      return Number.isNaN(t) ? null : t;
    }
    return null;
  }
  if (type === 'number') return toNumber(v);
  if (typeof v === 'number' || typeof v === 'string') return v;
  return null;
}

function eqVal(x: unknown, y: unknown, type: CellFieldType): boolean {
  const ox = ord(x, type);
  const oy = ord(y, type);
  if (ox !== null && oy !== null) return ox === oy;
  return x === y;
}

/** Compares two ordered primitives; NaN when they are of different, incomparable kinds. */
function cmp(a: number | string, b: number | string): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'string' && typeof b === 'string') return a < b ? -1 : a > b ? 1 : 0;
  return Number.NaN;
}
