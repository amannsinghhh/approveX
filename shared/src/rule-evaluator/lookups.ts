import type { ConditionNode, FieldSchema } from './types';
import { fieldMetaOf } from './types';

/**
 * Walks a condition AST and returns the (deduped) names of every referenced
 * field whose registry entry declares `source: looked_up` (B.3 #10). The API
 * pre-resolves these via LookupProviderService before evaluation; the
 * evaluator itself only ever reads the injected EvaluateOptions.lookups and
 * fails closed (`missing_lookup`) when a key is absent.
 */
export function collectLookupFields(node: ConditionNode, schema: FieldSchema): string[] {
  const fields = new Set<string>();
  visit(node, schema, fields);
  return [...fields];
}

function visit(node: ConditionNode, schema: FieldSchema, fields: Set<string>): void {
  if ('children' in node) {
    for (const child of node.children) visit(child, schema, fields);
    return;
  }
  if (fieldMetaOf(schema, node.field)?.source === 'looked_up') {
    fields.add(node.field);
  }
}
