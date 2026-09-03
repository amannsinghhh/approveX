import type { AggregateOperator } from './aggregates';
import { aggregateOperandIssues } from './aggregates';
import { isOperatorLegalForType, OPERAND_SHAPE } from './operators';
import { isPatternSafe } from './regex';
import type { ComparisonOperator, ConditionNode, FieldSchema, LogicalNode } from './types';
import {
  COMPARISON_OPERATORS,
  FIELD_PATTERN,
  fieldTypeOf,
  LOGICAL_OPERATORS,
  MAX_AST_DEPTH,
  MAX_AST_NODES,
  isLogicalNode,
} from './types';

export { FIELD_PATTERN };

export interface ValidationIssue {
  path: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

/**
 * Structural validation of a condition AST. Called at rule create/publish time
 * so the evaluator can assume well-formed input. When `fieldSchema` is supplied,
 * also checks that each operator is legal for its field's declared type (B.1).
 */
export function validateConditionAst(node: unknown, fieldSchema?: FieldSchema): ValidationResult {
  const issues: ValidationIssue[] = [];
  let nodeCount = 0;

  const visit = (candidate: unknown, path: string, depth: number): void => {
    nodeCount += 1;
    if (nodeCount > MAX_AST_NODES) {
      if (nodeCount === MAX_AST_NODES + 1) {
        issues.push({ path, message: `AST exceeds the maximum of ${MAX_AST_NODES} nodes` });
      }
      return;
    }
    if (depth > MAX_AST_DEPTH) {
      issues.push({ path, message: `Nesting exceeds the maximum depth of ${MAX_AST_DEPTH}` });
      return;
    }
    if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) {
      issues.push({ path, message: 'Node must be an object' });
      return;
    }

    const record = candidate as Record<string, unknown>;
    const operator = record.operator;

    if (typeof operator !== 'string') {
      issues.push({ path, message: 'Node is missing an operator' });
      return;
    }

    if ((LOGICAL_OPERATORS as readonly string[]).includes(operator)) {
      const children = record.children;
      if ('field' in record || 'value' in record) {
        issues.push({ path, message: `${operator} nodes cannot carry field/value` });
      }
      if (!Array.isArray(children)) {
        issues.push({ path, message: `${operator} requires a children array` });
        return;
      }
      if (children.length === 0) {
        // A root empty-AND is a deliberate catch-all: AND of nothing is
        // vacuously true, so the rule matches every payload (fallback, B.3 #15).
        if (operator === 'AND' && depth === 1) return;
        issues.push({ path, message: `${operator} requires a non-empty children array` });
        return;
      }
      if (operator === 'NOT' && children.length !== 1) {
        issues.push({ path, message: 'NOT takes exactly one child' });
        return;
      }
      children.forEach((child, index) => visit(child, `${path}[${index}]`, depth + 1));
      return;
    }

    if (!(COMPARISON_OPERATORS as readonly string[]).includes(operator)) {
      issues.push({ path, message: `Unknown operator "${operator}"` });
      return;
    }
    const op = operator as ComparisonOperator;

    // Comparison node
    if ('children' in record) {
      issues.push({ path, message: `${op} nodes cannot have children` });
    }
    const field = record.field;
    let fieldOk = false;
    if (typeof field !== 'string' || field.length === 0) {
      issues.push({ path, message: 'Comparison node requires a field' });
    } else if (!FIELD_PATTERN.test(field)) {
      issues.push({ path, message: `Invalid field path "${field}"` });
    } else {
      fieldOk = true;
    }

    // Operator ↔ field-type legality (only when the field is registered).
    if (fieldOk && fieldSchema) {
      const type = fieldTypeOf(fieldSchema, field as string);
      if (type && !isOperatorLegalForType(op, type)) {
        issues.push({ path, message: `Operator ${op} is not valid for ${type} field "${field}"` });
      }
    }

    // Cross-field reference: value must be a field path.
    if (record.valueType === 'field') {
      if (typeof record.value !== 'string' || !FIELD_PATTERN.test(record.value)) {
        issues.push({ path, message: `${op} with a field reference needs a valid field path value` });
      }
      // A cross-field value is validated as a path, not as a literal shape.
      return;
    }
    if (record.valueType !== undefined && record.valueType !== 'literal') {
      issues.push({ path, message: `valueType must be "literal" or "field"` });
    }

    validateOperand(op, record.value, path, issues, visit, depth);
  };

  visit(node, 'root', 1);
  return { valid: issues.length === 0, issues };
}

type Visit = (candidate: unknown, path: string, depth: number) => void;

/** Validates a comparison node's value against the operator's operand shape. */
function validateOperand(
  op: ComparisonOperator,
  value: unknown,
  path: string,
  issues: ValidationIssue[],
  visit: Visit,
  depth: number,
): void {
  const shape = OPERAND_SHAPE[op];
  switch (shape) {
    case 'none':
      if (value !== undefined) issues.push({ path, message: `${op} does not take a value` });
      return;
    case 'array':
      if (!Array.isArray(value) || value.length === 0) {
        issues.push({ path, message: `${op} requires a non-empty array value` });
      }
      return;
    case 'pair':
      if (!Array.isArray(value) || value.length !== 2) {
        issues.push({ path, message: `${op} requires a [min, max] array` });
      }
      return;
    case 'number':
      if (typeof value !== 'number' || Number.isNaN(value)) {
        issues.push({ path, message: `${op} requires a numeric value` });
      }
      return;
    case 'string':
      if (typeof value !== 'string' || value.length === 0) {
        const need = op === 'MATCHES_REGEX' ? 'a pattern string' : 'a non-empty string value';
        issues.push({ path, message: `${op} requires ${need}` });
      } else if (op === 'MATCHES_REGEX') {
        try {
          new RegExp(value);
        } catch {
          issues.push({ path, message: `Invalid regular expression: ${value}` });
        }
        if (!isPatternSafe(value)) {
          issues.push({
            path,
            message: 'Pattern rejected by the ReDoS safety screen (nested quantifiers or too long)',
          });
        }
      }
      return;
    case 'percent': {
      const spec = value as { percent?: unknown; of?: unknown } | null;
      if (!spec || typeof spec !== 'object' || typeof spec.percent !== 'number') {
        issues.push({ path, message: `${op} requires { percent: number, of: <field> }` });
      } else if (typeof spec.of !== 'string' || !FIELD_PATTERN.test(spec.of)) {
        issues.push({ path, message: `${op} needs a valid "of" field path` });
      }
      return;
    }
    case 'time_pair':
      if (
        !Array.isArray(value) ||
        value.length !== 2 ||
        !value.every((v) => typeof v === 'string' && /^\d{1,2}:\d{2}$/.test(v))
      ) {
        issues.push({ path, message: `${op} requires ["HH:MM", "HH:MM"]` });
      }
      return;
    case 'day_list':
      if (!Array.isArray(value) || value.length === 0) {
        issues.push({ path, message: `${op} requires a non-empty day list` });
      }
      return;
    case 'list_name':
      // The value names a managed list; existence of the list is checked at
      // publish time (the evaluator has no list catalog here). Structurally it
      // must be a non-empty string.
      if (typeof value !== 'string' || value.length === 0) {
        issues.push({ path, message: `${op} requires a managed list name` });
      }
      return;
    case 'sub_condition':
      if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        issues.push({ path, message: `${op} requires a nested condition` });
      } else {
        visit(value, `${path}.item`, depth + 1);
      }
      return;
    case 'aggregate':
      for (const message of aggregateOperandIssues(op as AggregateOperator, value)) {
        issues.push({ path, message });
      }
      return;
    case 'scalar':
    default:
      if (value === undefined || value === null) {
        issues.push({ path, message: `${op} requires a value` });
      }
      return;
  }
}

/** Number of comparison leaves — the specificity measure for conflict resolution. */
export function countComparisons(node: ConditionNode): number {
  if (isLogicalNode(node)) {
    return (node as LogicalNode).children.reduce((sum, child) => sum + countComparisons(child), 0);
  }
  return 1;
}

/**
 * A catch-all rule matches every payload — a root empty-AND (B.3 #15). Every
 * real condition has at least one comparison leaf, so zero leaves uniquely
 * identifies the fallback. Contexts should have exactly one as a safety net.
 */
export function isCatchAllAst(node: ConditionNode): boolean {
  return isLogicalNode(node) && node.operator === 'AND' && node.children.length === 0;
}

/** The canonical catch-all condition: matches everything. */
export function catchAllAst(): ConditionNode {
  return { operator: 'AND', children: [] };
}
