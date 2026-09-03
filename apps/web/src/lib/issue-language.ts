/** Part A error-language pass: translate machine validation issues
 * (`root[2][1]`, `rows[3].cells[0]`) into plain locations, add fix hints,
 * and provide DOM anchors so clicking an issue scrolls to the culprit. */

interface ValidationIssueLike {
  path: string;
  message: string;
}

export interface HumanizedIssue {
  /** Plain-language place, e.g. "Condition 3 → 2" or "Row 4 · amount". */
  location: string;
  /** Original validator message (already human-readable). */
  message: string;
  /** Optional plain-language suggestion for non-technical users. */
  hint?: string;
  /** CSS selector for the offending element, when one exists. */
  anchor?: string;
  /** Raw machine path, shown only to technical roles. */
  path: string;
}

/** Ordered [pattern, hint] pairs — first match wins. */
const HINTS: Array<[RegExp, string]> = [
  [/Unexpected output key/, 'Remove this value or add a matching output column first.'],
  [/Missing output key/, 'Fill in every output for this row, or chain it to another table.'],
  [/needs a valid field path/i, 'Pick a field from the registry, e.g. amount or vendor.country.'],
  [/not valid for/, 'This operator does not fit the field’s type — choose another operator.'],
  [/children array|at least one child/i, 'Add at least one condition inside this group.'],
  [/\[min, max\]|BETWEEN/, 'Provide both a minimum and a maximum, e.g. 50000..500000.'],
  [/cells but the table has/, 'Each row needs one cell per condition column — add or remove cells.'],
  [/Cells must be strings/, 'Cell values must be text — try *, a number, or a range like 100..200.'],
  [/priority must be a number/, 'Priority breaks ties under the "best" hit policy — enter a number.'],
  [/maximum depth|maximum of/i, 'This rule is too deeply nested — flatten some groups.'],
  [/valueType.*field|references itself/i, 'A field comparison must point at a different field.'],
];

function hintFor(message: string): string | undefined {
  for (const [pattern, hint] of HINTS) {
    if (pattern.test(message)) return hint;
  }
  return undefined;
}

const bracketIndices = (path: string): number[] =>
  [...path.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]));

/** Humanize an issue from validateConditionAst (paths like `root[2][1]`). */
export function humanizeConditionIssue(issue: ValidationIssueLike): HumanizedIssue {
  const { path, message } = issue;
  let location = path;
  let anchor: string | undefined;
  if (/^root(\[\d+\])*$/.test(path)) {
    const indices = bracketIndices(path);
    location =
      indices.length === 0
        ? 'Top-level group'
        : `Condition ${indices.map((i) => i + 1).join(' → ')}`;
    anchor = `[data-ast-path="${path}"]`;
  }
  return { location, message, hint: hintFor(message), anchor, path };
}

/** Humanize an issue from validateDecisionTable (paths like `rows[3].cells[0]`). */
export function humanizeTableIssue(
  issue: ValidationIssueLike,
  columnFields: string[],
): HumanizedIssue {
  const { path, message } = issue;
  const base = { message, hint: hintFor(message), path };

  let match = /^rows\[(\d+)\]\.cells\[(\d+)\]$/.exec(path);
  if (match) {
    const row = Number(match[1]);
    const col = Number(match[2]);
    const field = columnFields[col] ?? `column ${col + 1}`;
    return { ...base, location: `Row ${row + 1} · ${field}`, anchor: `[data-row-anchor="${row}"]` };
  }
  match = /^rows\[(\d+)\]\.output\.(.+)$/.exec(path);
  if (match) {
    const row = Number(match[1]);
    const key = match[2] ?? '';
    const label = key.startsWith('$') ? 'chained table' : `output "${key}"`;
    return { ...base, location: `Row ${row + 1} · ${label}`, anchor: `[data-row-anchor="${row}"]` };
  }
  match = /^rows\[(\d+)\]\.(output|priority)$/.exec(path);
  if (match) {
    const row = Number(match[1]);
    return {
      ...base,
      location: `Row ${row + 1} · ${match[2] === 'output' ? 'outputs' : 'priority'}`,
      anchor: `[data-row-anchor="${row}"]`,
    };
  }
  match = /^rows\[(\d+)\]$/.exec(path);
  if (match) {
    const row = Number(match[1]);
    return { ...base, location: `Row ${row + 1}`, anchor: `[data-row-anchor="${row}"]` };
  }
  match = /^columns\[(\d+)\]$/.exec(path);
  if (match) {
    const col = Number(match[1]);
    return { ...base, location: `Column ${col + 1}`, anchor: `[data-col-anchor="${col}"]` };
  }
  const NAMES: Record<string, string> = {
    hitPolicy: 'Hit policy',
    columns: 'Condition columns',
    rows: 'Rows',
    root: 'Table',
  };
  return { ...base, location: NAMES[path] ?? path };
}

/** Scroll the offending element into view and flash it briefly. */
export function scrollToIssue(anchor: string | undefined): void {
  if (!anchor) return;
  const el = document.querySelector<HTMLElement>(anchor);
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  const previous = el.style.boxShadow;
  el.style.boxShadow = '0 0 0 2px rgb(190 60 60 / 0.8)';
  window.setTimeout(() => {
    el.style.boxShadow = previous;
  }, 1200);
}
