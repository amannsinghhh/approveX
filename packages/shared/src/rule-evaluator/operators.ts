/**
 * Operator catalog metadata (B.1): which operators are legal on which field
 * type, and the operand shape each expects. The Rule Builder filters its
 * dropdown with operatorsForType(); validation uses OPERAND_SHAPE and
 * isOperatorLegalForType().
 */
import type { ComparisonOperator, FieldType } from './types';

/** Operators valid on every type (null/existence checks). */
const UNIVERSAL: ComparisonOperator[] = ['IS_NULL', 'IS_NOT_NULL', 'EXISTS', 'NOT_EXISTS'];

const NUMERIC: ComparisonOperator[] = [
  '=',
  '!=',
  '>',
  '>=',
  '<',
  '<=',
  'BETWEEN',
  'NOT_BETWEEN',
  'IN',
  'NOT_IN',
  'IN_LIST',
  'NOT_IN_LIST',
  'MULTIPLE_OF',
  'WITHIN_PERCENT_OF',
];

const STRING: ComparisonOperator[] = [
  '=',
  '!=',
  'IN',
  'NOT_IN',
  'IN_IGNORE_CASE',
  'IN_LIST',
  'NOT_IN_LIST',
  'CONTAINS',
  'NOT_CONTAINS',
  'STARTS_WITH',
  'ENDS_WITH',
  'MATCHES_REGEX',
  'EQUALS_IGNORE_CASE',
  'IS_EMPTY',
  'IS_NOT_EMPTY',
];

const BOOLEAN: ComparisonOperator[] = ['=', '!='];

const DATE: ComparisonOperator[] = [
  '=',
  '!=',
  'BEFORE',
  'AFTER',
  'ON',
  'BETWEEN',
  'WITHIN_LAST_N_DAYS',
  'WITHIN_NEXT_N_DAYS',
  'OLDER_THAN_N_DAYS',
  'DAY_OF_WEEK_IN',
  'TIME_OF_DAY_BETWEEN',
];

/** Array-valued fields (line_items, tags, ...). */
const ARRAY: ComparisonOperator[] = [
  'CONTAINS',
  'NOT_CONTAINS',
  'CONTAINS_ALL',
  'CONTAINS_ANY',
  'LENGTH_EQ',
  'LENGTH_GT',
  'LENGTH_LT',
  'IS_EMPTY',
  'IS_NOT_EMPTY',
  'ANY_ITEM_MATCHES',
  'ALL_ITEMS_MATCH',
];

/**
 * Aggregate/lookback operators (B.3 #5) group history by the field's value, so
 * they're offered on group-key-ish types (number, string) and untyped fields.
 */
const AGGREGATE: ComparisonOperator[] = ['AGGREGATE_COUNT_WITHIN', 'AGGREGATE_SUM_WITHIN'];

export const OPERATORS_BY_TYPE: Record<FieldType, ComparisonOperator[]> = {
  number: [...NUMERIC, ...AGGREGATE, ...UNIVERSAL],
  string: [...STRING, ...AGGREGATE, ...UNIVERSAL],
  boolean: [...BOOLEAN, ...UNIVERSAL],
  date: [...DATE, ...UNIVERSAL],
};

/** Array operators are offered when a field is untyped (arrays aren't a base FieldType). */
export const UNTYPED_OPERATORS: ComparisonOperator[] = Array.from(
  new Set<ComparisonOperator>([...NUMERIC, ...STRING, ...DATE, ...ARRAY, ...AGGREGATE, ...UNIVERSAL]),
);

/** Operators offered for a given field type (undefined ⇒ untyped, offer everything). */
export function operatorsForType(type: FieldType | undefined): ComparisonOperator[] {
  return type ? OPERATORS_BY_TYPE[type] : UNTYPED_OPERATORS;
}

/**
 * A registered field only accepts operators for its declared type. Array
 * operators are always allowed (a field may be typed loosely but hold an array),
 * and the universal null/existence checks are always legal.
 */
export function isOperatorLegalForType(
  operator: ComparisonOperator,
  type: FieldType | undefined,
): boolean {
  if (!type) return true;
  if (OPERATORS_BY_TYPE[type].includes(operator)) return true;
  return ARRAY.includes(operator);
}

/** Operand shape each operator expects, for validation. */
export type OperandShape =
  | 'none' // no value
  | 'scalar' // single literal (or field ref when valueType=field)
  | 'array' // non-empty value[]
  | 'pair' // exactly [a, b]
  | 'number' // a number literal
  | 'string' // a string literal
  | 'percent' // { percent: number, of: <field path> }
  | 'time_pair' // ["HH:MM", "HH:MM"]
  | 'day_list' // (0-6 | day name)[]
  | 'list_name' // a managed list's name (string), resolved at evaluate time
  | 'sub_condition' // a nested ConditionNode
  | 'aggregate'; // an AggregateOperand — { window, compare, threshold, sumField? }

export const OPERAND_SHAPE: Record<ComparisonOperator, OperandShape> = {
  '=': 'scalar',
  '!=': 'scalar',
  '>': 'scalar',
  '>=': 'scalar',
  '<': 'scalar',
  '<=': 'scalar',
  IN: 'array',
  NOT_IN: 'array',
  IN_IGNORE_CASE: 'array',
  IN_LIST: 'list_name',
  NOT_IN_LIST: 'list_name',
  BETWEEN: 'pair',
  NOT_BETWEEN: 'pair',
  MULTIPLE_OF: 'number',
  WITHIN_PERCENT_OF: 'percent',
  CONTAINS: 'scalar',
  NOT_CONTAINS: 'scalar',
  STARTS_WITH: 'string',
  ENDS_WITH: 'string',
  MATCHES_REGEX: 'string',
  EQUALS_IGNORE_CASE: 'string',
  IS_EMPTY: 'none',
  IS_NOT_EMPTY: 'none',
  BEFORE: 'scalar',
  AFTER: 'scalar',
  ON: 'scalar',
  WITHIN_LAST_N_DAYS: 'number',
  WITHIN_NEXT_N_DAYS: 'number',
  OLDER_THAN_N_DAYS: 'number',
  DAY_OF_WEEK_IN: 'day_list',
  TIME_OF_DAY_BETWEEN: 'time_pair',
  CONTAINS_ALL: 'array',
  CONTAINS_ANY: 'array',
  LENGTH_EQ: 'number',
  LENGTH_GT: 'number',
  LENGTH_LT: 'number',
  ANY_ITEM_MATCHES: 'sub_condition',
  ALL_ITEMS_MATCH: 'sub_condition',
  AGGREGATE_COUNT_WITHIN: 'aggregate',
  AGGREGATE_SUM_WITHIN: 'aggregate',
  IS_NULL: 'none',
  IS_NOT_NULL: 'none',
  EXISTS: 'none',
  NOT_EXISTS: 'none',
};

/** Operators that resolve their own field(s) and never take an explicit value. */
export const NO_VALUE_OPERATORS: ComparisonOperator[] = [
  'IS_NULL',
  'IS_NOT_NULL',
  'IS_EMPTY',
  'IS_NOT_EMPTY',
  'EXISTS',
  'NOT_EXISTS',
];

/** Day-of-week names accepted by DAY_OF_WEEK_IN (0 = Sunday). */
export const DAY_NAMES = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] as const;
