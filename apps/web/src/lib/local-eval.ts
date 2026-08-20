/**
 * Options for in-browser draft evaluation (Rule Builder "Check your work",
 * decision-table test panel). Mirrors the API's option construction in
 * apps/api/src/rules/rule-cache.service.ts (getFieldSchema / getManagedLists)
 * so a draft tested here gives the same verdict POST /evaluate would.
 *
 * Deliberate differences from the API, both browser constraints:
 * - `source: looked_up` is not copied into the schema. The API resolves those
 *   fields over outbound HTTP before evaluating; the browser cannot, so the
 *   tester reads the payload value as a stand-in instead of failing closed.
 * - No `aggregates`: AGGREGATE_* operators need request history and still
 *   fail closed here with a `missing_aggregate` trace note.
 */
import type { EvaluateOptions, FieldMeta, FieldSchema } from '@approvex/shared';
import type { FieldDefinition, ManagedList } from './types';

export function buildFieldSchema(fields: FieldDefinition[]): FieldSchema {
  return Object.fromEntries(
    fields.map((f) => {
      const meta: FieldMeta = { type: f.type };
      if (f.unit) meta.unit = f.unit;
      if (f.precision !== null && f.precision !== undefined) meta.precision = f.precision;
      if (f.nullable === false) meta.nullable = false;
      if (f.defaultIfMissing !== null && f.defaultIfMissing !== undefined) {
        meta.defaultIfMissing = f.defaultIfMissing;
      }
      if (f.enumValues && f.enumValues.length > 0) meta.enumValues = f.enumValues;
      return [f.name, meta];
    }),
  );
}

export function buildLocalEvalOptions(
  fields: FieldDefinition[],
  lists: ManagedList[] = [],
): EvaluateOptions {
  return {
    fieldSchema: buildFieldSchema(fields),
    managedLists: Object.fromEntries(lists.map((l) => [l.name, l.values])),
  };
}
