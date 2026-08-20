/**
 * Visual condition builder (UI spec §5.2). Groups are nested cards with a 2px
 * brand left border and an ALL/ANY toggle; conditions are field/operator/value
 * rows whose inputs adapt to the field's registered type.
 *
 * The operator dropdown and every value input are driven by the SHARED engine
 * catalog (operatorsForType + OPERAND_SHAPE), so the builder always offers
 * exactly what the evaluator supports — including the full M1 operator set,
 * managed-list membership (IN_LIST) and cross-field comparisons.
 */
import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { cn } from '../lib/cn';
import type {
  AggregateOperand,
  ComparisonOperator,
  ConditionNode,
  FieldType,
  OperandShape,
} from '@approvex/shared';
import {
  AGGREGATE_COMPARISONS,
  DAY_NAMES,
  NO_VALUE_OPERATORS,
  OPERAND_SHAPE,
  isLogicalNode,
  operatorsForType,
} from '@approvex/shared';
import { Button, Input, Segmented, Select } from './ui';

export interface FieldDef {
  name: string;
  type: FieldType;
}

type Comparison = Extract<ConditionNode, { field: string }>;

export const emptyComparison = (): ConditionNode => ({ field: '', operator: '=', value: '' });
export const emptyGroup = (): ConditionNode => ({
  operator: 'AND',
  children: [emptyComparison()],
});

const shapeOf = (operator: ComparisonOperator): OperandShape => OPERAND_SHAPE[operator];

/**
 * Human-readable operator labels. The dropdown used to show raw engine enums
 * (`AGGREGATE_SUM_WITHIN`, `!=`) — accurate, but only decodable by whoever
 * wrote the engine. Rows now read as sentences: "amount · is greater than · 500000".
 * The raw enum stays available as the option's title/tooltip.
 */
const OPERATOR_LABELS: Partial<Record<ComparisonOperator, string>> = {
  '=': 'is equal to',
  '!=': 'is not equal to',
  '>': 'is greater than',
  '>=': 'is at least',
  '<': 'is less than',
  '<=': 'is at most',
  IN: 'is one of',
  NOT_IN: 'is not one of',
  IN_IGNORE_CASE: 'is one of (any case)',
  IN_LIST: 'is in managed list',
  NOT_IN_LIST: 'is not in managed list',
  BETWEEN: 'is between',
  NOT_BETWEEN: 'is not between',
  MULTIPLE_OF: 'is a multiple of',
  WITHIN_PERCENT_OF: 'is within % of another field',
  CONTAINS: 'contains',
  NOT_CONTAINS: 'does not contain',
  STARTS_WITH: 'starts with',
  ENDS_WITH: 'ends with',
  MATCHES_REGEX: 'matches pattern (regex)',
  EQUALS_IGNORE_CASE: 'equals (any case)',
  IS_EMPTY: 'is empty',
  IS_NOT_EMPTY: 'is not empty',
  BEFORE: 'is before',
  AFTER: 'is after',
  ON: 'is on the date',
  WITHIN_LAST_N_DAYS: 'is within the last … days',
  WITHIN_NEXT_N_DAYS: 'is within the next … days',
  OLDER_THAN_N_DAYS: 'is older than … days',
  DAY_OF_WEEK_IN: 'falls on weekday',
  TIME_OF_DAY_BETWEEN: 'time of day is between',
  CONTAINS_ALL: 'contains all of',
  CONTAINS_ANY: 'contains any of',
  LENGTH_EQ: 'has exactly … items',
  LENGTH_GT: 'has more than … items',
  LENGTH_LT: 'has fewer than … items',
  ANY_ITEM_MATCHES: 'has an item where',
  ALL_ITEMS_MATCH: 'has every item where',
  AGGREGATE_COUNT_WITHIN: 'request count over a window',
  AGGREGATE_SUM_WITHIN: 'running total over a window',
  IS_NULL: 'is null',
  IS_NOT_NULL: 'is not null',
  EXISTS: 'is present in the payload',
  NOT_EXISTS: 'is missing from the payload',
};

export const operatorLabel = (operator: ComparisonOperator): string =>
  OPERATOR_LABELS[operator] ?? operator.toLowerCase().replaceAll('_', ' ');

function parseTyped(raw: string, type: FieldType | undefined): unknown {
  if (type === 'number') {
    const num = Number(raw);
    return raw.trim() !== '' && !Number.isNaN(num) ? num : raw;
  }
  if (type === 'boolean') return raw === 'true';
  return raw;
}

/** The value an operator starts with when it is freshly selected. */
function defaultValueForOperator(operator: ComparisonOperator, previous: unknown): unknown {
  switch (shapeOf(operator)) {
    case 'none':
      return undefined;
    case 'array':
    case 'day_list':
      return [];
    case 'pair':
    case 'time_pair':
      return ['', ''];
    case 'percent':
      return { percent: 10, of: '' };
    case 'sub_condition':
      return { field: '', operator: '=', value: '' } satisfies ConditionNode;
    case 'aggregate':
      return {
        window: { kind: 'rolling', days: 30 },
        compare: '>',
        threshold: 0,
        ...(operator === 'AGGREGATE_SUM_WITHIN' ? { sumField: '' } : {}),
      } satisfies AggregateOperand;
    case 'list_name':
      return typeof previous === 'string' ? previous : '';
    default:
      // scalar / number / string — keep a compatible scalar, else reset.
      return typeof previous === 'object' && previous !== null ? '' : (previous ?? '');
  }
}

function ArrayInput({
  value,
  fieldType,
  onChange,
}: {
  value: unknown;
  fieldType: FieldType | undefined;
  onChange: (value: unknown[]) => void;
}): React.JSX.Element {
  const list = Array.isArray(value) ? value : [];
  return (
    <Input
      className="w-56 font-mono text-sm"
      placeholder="Finance, Procurement"
      aria-label="Values (comma separated)"
      value={list.join(', ')}
      onChange={(e) =>
        onChange(
          e.target.value
            .split(',')
            .map((part) => parseTyped(part.trim(), fieldType))
            .filter((part) => part !== ''),
        )
      }
    />
  );
}

function PairInput({
  value,
  inputType,
  labels,
  onChange,
}: {
  value: unknown;
  inputType: string;
  labels: [string, string];
  onChange: (value: [unknown, unknown]) => void;
}): React.JSX.Element {
  const pair = Array.isArray(value) ? value : ['', ''];
  return (
    <span className="flex items-center gap-1">
      <Input
        type={inputType}
        className="w-28 font-mono text-sm"
        aria-label={labels[0]}
        value={String(pair[0] ?? '')}
        onChange={(e) => onChange([e.target.value, pair[1]])}
      />
      <span className="text-sm text-ink-soft">and</span>
      <Input
        type={inputType}
        className="w-28 font-mono text-sm"
        aria-label={labels[1]}
        value={String(pair[1] ?? '')}
        onChange={(e) => onChange([pair[0], e.target.value])}
      />
    </span>
  );
}

function DayListInput({
  value,
  onChange,
}: {
  value: unknown;
  onChange: (value: string[]) => void;
}): React.JSX.Element {
  const selected = new Set((Array.isArray(value) ? value : []).map(String));
  const toggle = (day: string): void => {
    const next = new Set(selected);
    if (next.has(day)) next.delete(day);
    else next.add(day);
    onChange([...next]);
  };
  return (
    <span className="flex flex-wrap gap-1" role="group" aria-label="Days of week">
      {DAY_NAMES.map((day) => (
        <button
          type="button"
          key={day}
          aria-pressed={selected.has(day)}
          onClick={() => toggle(day)}
          className={`rounded-[6px] border px-2 py-1 font-mono text-xs ${
            selected.has(day)
              ? 'border-brand bg-brand-bg text-brand'
              : 'border-rule text-ink-soft hover:text-ink'
          }`}
        >
          {day}
        </button>
      ))}
    </span>
  );
}

function PercentInput({
  value,
  fields,
  onChange,
}: {
  value: unknown;
  fields: FieldDef[];
  onChange: (value: { percent: number; of: string }) => void;
}): React.JSX.Element {
  const v = (value ?? {}) as { percent?: number; of?: string };
  return (
    <span className="flex items-center gap-1">
      <Input
        type="number"
        className="w-20 font-mono text-sm"
        aria-label="Percent"
        value={String(v.percent ?? '')}
        onChange={(e) => onChange({ percent: Number(e.target.value), of: v.of ?? '' })}
      />
      <span className="text-sm text-ink-soft">% of</span>
      <Select
        aria-label="Reference field"
        className="min-w-36 font-mono text-sm"
        value={v.of ?? ''}
        onChange={(e) => onChange({ percent: v.percent ?? 0, of: e.target.value })}
      >
        <option value="" disabled>
          Choose field…
        </option>
        {fields.map((f) => (
          <option key={f.name} value={f.name}>
            {f.name}
          </option>
        ))}
      </Select>
    </span>
  );
}

/**
 * Editor for AGGREGATE_COUNT_WITHIN / AGGREGATE_SUM_WITHIN operands (B.3 #5).
 * The row's field is the grouping key; this edits window + compare + threshold
 * and, for SUM, the numeric history field being totalled.
 */
function AggregateInput({
  operator,
  value,
  fields,
  onChange,
}: {
  operator: ComparisonOperator;
  value: unknown;
  fields: FieldDef[];
  onChange: (value: AggregateOperand) => void;
}): React.JSX.Element {
  const v = (value ?? {}) as Partial<AggregateOperand>;
  const window = v.window ?? { kind: 'rolling' as const, days: 30 };
  const compare = v.compare ?? '>';
  const threshold = v.threshold ?? 0;
  const isSum = operator === 'AGGREGATE_SUM_WITHIN';
  const patch = (next: Partial<AggregateOperand>): void =>
    onChange({
      window,
      compare,
      threshold,
      ...(isSum ? { sumField: v.sumField ?? '' } : {}),
      ...next,
    } as AggregateOperand);
  const numberFields = fields.filter((f) => f.type === 'number');

  return (
    <span className="flex flex-wrap items-center gap-1">
      {isSum && (
        <>
          <span className="text-sm text-ink-soft">of</span>
          <Select
            aria-label="Sum field"
            className="min-w-32 font-mono text-sm"
            value={v.sumField ?? ''}
            onChange={(e) => patch({ sumField: e.target.value })}
          >
            <option value="" disabled>
              Choose a number field…
            </option>
            {numberFields.map((f) => (
              <option key={f.name} value={f.name}>
                {f.name}
              </option>
            ))}
          </Select>
        </>
      )}
      <span className="text-sm text-ink-soft">in</span>
      <Select
        aria-label="Window"
        className="font-mono text-sm"
        value={window.kind}
        onChange={(e) =>
          patch({
            window:
              e.target.value === 'fiscal_year_to_date'
                ? { kind: 'fiscal_year_to_date' }
                : { kind: 'rolling', days: window.kind === 'rolling' ? window.days : 30 },
          })
        }
      >
        <option value="rolling">rolling days</option>
        <option value="fiscal_year_to_date">fiscal year to date</option>
      </Select>
      {window.kind === 'rolling' && (
        <Input
          type="number"
          min={1}
          className="w-20 font-mono text-sm"
          aria-label="Window days"
          value={String(window.days ?? '')}
          onChange={(e) => patch({ window: { kind: 'rolling', days: Number(e.target.value) } })}
        />
      )}
      <span className="text-sm text-ink-soft">is</span>
      <Select
        aria-label="Aggregate comparison"
        className="font-mono text-sm"
        value={compare}
        onChange={(e) => patch({ compare: e.target.value as AggregateOperand['compare'] })}
      >
        {AGGREGATE_COMPARISONS.map((op) => (
          <option key={op} value={op}>
            {op}
          </option>
        ))}
      </Select>
      <Input
        type="number"
        className="w-28 font-mono text-sm"
        aria-label="Threshold"
        value={String(threshold)}
        onChange={(e) => patch({ threshold: Number(e.target.value) })}
      />
    </span>
  );
}

function ValueInput({
  node,
  fieldType,
  fields,
  lists,
  onChange,
}: {
  node: Comparison;
  fieldType: FieldType | undefined;
  fields: FieldDef[];
  lists: string[];
  onChange: (value: unknown) => void;
}): React.JSX.Element | null {
  const shape = shapeOf(node.operator);
  const isFieldRef = node.valueType === 'field';

  if (shape === 'none') return null;

  if (shape === 'sub_condition') {
    const sub =
      node.value && typeof node.value === 'object' && 'operator' in (node.value as object)
        ? (node.value as Comparison)
        : ({ field: '', operator: '=', value: '' } as Comparison);
    return (
      <span className="rounded-[6px] border border-dashed border-rule px-2 py-1">
        <ConditionRow
          node={sub}
          fields={fields}
          lists={lists}
          onChange={(next) => onChange(next)}
          onRemove={() => {}}
        />
      </span>
    );
  }

  if (shape === 'list_name') {
    const selected = typeof node.value === 'string' ? node.value : '';
    // Preserve an unknown/stale list name so editing never silently drops it.
    const options = selected && !lists.includes(selected) ? [selected, ...lists] : lists;
    return (
      <Select
        aria-label="Managed list"
        className="min-w-44 font-mono text-sm"
        value={selected}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="" disabled>
          Choose a managed list…
        </option>
        {options.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </Select>
    );
  }

  if (shape === 'aggregate') {
    return (
      <AggregateInput
        operator={node.operator}
        value={node.value}
        fields={fields}
        onChange={onChange}
      />
    );
  }

  if (shape === 'percent') {
    return <PercentInput value={node.value} fields={fields} onChange={onChange} />;
  }

  if (shape === 'day_list') {
    return <DayListInput value={node.value} onChange={onChange} />;
  }

  if (shape === 'time_pair') {
    return (
      <PairInput value={node.value} inputType="time" labels={['From', 'To']} onChange={onChange} />
    );
  }

  if (shape === 'pair') {
    const inputType = fieldType === 'date' ? 'date' : 'text';
    return (
      <PairInput
        value={node.value}
        inputType={inputType}
        labels={['Minimum', 'Maximum']}
        onChange={(pair) => onChange(pair.map((p) => parseTyped(String(p), fieldType)))}
      />
    );
  }

  if (shape === 'array') {
    return <ArrayInput value={node.value} fieldType={fieldType} onChange={onChange} />;
  }

  // Cross-field: a scalar operator may compare against another field's value.
  if (isFieldRef) {
    return (
      <Select
        aria-label="Compared field"
        className="min-w-36 font-mono text-sm"
        value={typeof node.value === 'string' ? node.value : ''}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="" disabled>
          Choose field…
        </option>
        {fields.map((f) => (
          <option key={f.name} value={f.name}>
            {f.name}
          </option>
        ))}
      </Select>
    );
  }

  if (shape === 'number') {
    return (
      <Input
        type="number"
        className="w-32 font-mono text-sm"
        aria-label="Value"
        value={String(node.value ?? '')}
        onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
      />
    );
  }

  if (shape === 'string') {
    return (
      <Input
        className="w-44 font-mono text-sm"
        aria-label="Value"
        placeholder={node.operator === 'MATCHES_REGEX' ? '^[A-Z]{2}\\d+$' : 'value'}
        value={String(node.value ?? '')}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }

  // scalar
  if (fieldType === 'boolean') {
    return (
      <Select
        aria-label="Value"
        value={String(node.value ?? 'true')}
        onChange={(e) => onChange(e.target.value === 'true')}
      >
        <option value="true">true</option>
        <option value="false">false</option>
      </Select>
    );
  }

  return (
    <Input
      type={fieldType === 'number' ? 'number' : fieldType === 'date' ? 'date' : 'text'}
      className="w-44 font-mono text-sm"
      aria-label="Value"
      placeholder="value"
      value={String(node.value ?? '')}
      onChange={(e) => onChange(parseTyped(e.target.value, fieldType))}
    />
  );
}

/** Operators whose scalar operand can instead reference another field. */
const supportsFieldRef = (operator: ComparisonOperator): boolean =>
  OPERAND_SHAPE[operator] === 'scalar';

export function ConditionRow({
  node,
  fields,
  lists,
  onChange,
  onRemove,
  path,
}: {
  node: Comparison;
  fields: FieldDef[];
  lists: string[];
  onChange: (node: ConditionNode) => void;
  onRemove: () => void;
  /** AST path (e.g. `root[2][1]`) — anchors validation-issue click-to-scroll. */
  path?: string;
}): React.JSX.Element {
  const known = fields.some((f) => f.name === node.field);
  // "Custom path" stays sticky once picked, so an empty value doesn't bounce
  // the row back to the placeholder while the user is still typing.
  const [customMode, setCustomMode] = useState(() => node.field !== '' && !known);
  const fieldType = fields.find((f) => f.name === node.field)?.type;
  const operators = operatorsForType(fieldType);
  // Keep a stale operator selectable so editing an existing rule never drops it.
  const operatorOptions = operators.includes(node.operator)
    ? operators
    : [node.operator, ...operators];
  const showCustomInput = customMode || (node.field !== '' && !known);
  const selectValue = known ? node.field : showCustomInput ? '__custom' : '';

  return (
    <div
      className="group flex flex-wrap items-center gap-1.5 rounded-[8px] border border-transparent px-1.5 py-1 transition-colors duration-150 hover:border-rule/70 hover:bg-paper/60"
      data-ast-path={path}
    >
      <Select
        aria-label="Field"
        value={selectValue}
        onChange={(e) => {
          if (e.target.value === '__custom') {
            setCustomMode(true);
            onChange({ ...node, field: '' });
            return;
          }
          setCustomMode(false);
          onChange({ ...node, field: e.target.value });
        }}
        className={cn('min-w-40', selectValue === '' && 'border-brand/60 text-ink-soft')}
      >
        <option value="" disabled>
          Choose a field…
        </option>
        {fields.map((field) => (
          <option key={field.name} value={field.name}>
            {field.name} · {field.type}
          </option>
        ))}
        <option value="__custom">Type a custom path…</option>
      </Select>
      {showCustomInput && (
        <Input
          className="w-40 font-mono text-sm"
          placeholder="vendor.country"
          aria-label="Custom field path"
          autoFocus={customMode && node.field === ''}
          value={node.field}
          onChange={(e) => onChange({ ...node, field: e.target.value })}
        />
      )}
      <Select
        aria-label="Operator"
        value={node.operator}
        onChange={(e) => {
          const operator = e.target.value as ComparisonOperator;
          const value = defaultValueForOperator(operator, node.value);
          const valueType = supportsFieldRef(operator) ? node.valueType : undefined;
          onChange({ field: node.field, operator, value, valueType });
        }}
        className="max-w-60 text-sm"
        title={node.operator}
      >
        {operatorOptions.map((op) => (
          <option key={op} value={op} title={op}>
            {operatorLabel(op)}
          </option>
        ))}
      </Select>
      {supportsFieldRef(node.operator) && !NO_VALUE_OPERATORS.includes(node.operator) && (
        <Segmented
          value={node.valueType === 'field' ? 'field' : 'literal'}
          options={[
            { value: 'literal', label: 'a value' },
            { value: 'field', label: 'another field' },
          ]}
          onChange={(vt) =>
            onChange({
              ...node,
              valueType: vt === 'field' ? 'field' : undefined,
              value: '',
            })
          }
        />
      )}
      <ValueInput
        node={node}
        fieldType={fieldType}
        fields={fields}
        lists={lists}
        onChange={(value) => onChange({ ...node, value })}
      />
      <Button
        variant="ghost"
        onClick={onRemove}
        aria-label="Remove condition"
        title="Remove this condition"
        className="h-8 px-1.5 opacity-40 transition-opacity hover:text-reject group-hover:opacity-100"
      >
        <Trash2 size={14} />
      </Button>
    </div>
  );
}

export function ConditionGroup({
  node,
  fields,
  lists = [],
  onChange,
  onRemove,
  depth = 0,
  path = 'root',
}: {
  node: ConditionNode;
  fields: FieldDef[];
  lists?: string[];
  onChange: (node: ConditionNode) => void;
  onRemove?: () => void;
  depth?: number;
  /** AST path matching validateConditionAst issue paths (`root[2][1]`). */
  path?: string;
}): React.JSX.Element {
  if (!isLogicalNode(node)) {
    return (
      <ConditionRow
        node={node}
        fields={fields}
        lists={lists}
        onChange={onChange}
        onRemove={onRemove ?? (() => {})}
        path={path}
      />
    );
  }

  const isNot = node.operator === 'NOT';
  const children = node.children;

  const setChild = (index: number, child: ConditionNode): void => {
    const next = [...children];
    next[index] = child;
    onChange({ ...node, children: next });
  };
  const removeChild = (index: number): void => {
    const next = children.filter((_, i) => i !== index);
    if (next.length === 0) {
      onRemove?.();
      return;
    }
    onChange({ ...node, children: next });
  };

  return (
    <div
      className="rounded-[10px] border border-rule border-l-[3px] border-l-brand bg-surface p-3 elev-sm"
      style={{ marginLeft: depth > 0 ? 4 : 0 }}
      data-ast-path={path}
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        {isNot ? (
          <span
            title="Inverted group — it matches when everything inside does NOT."
            className="-rotate-1 rounded-[2px] border-[1.5px] border-reject bg-reject-bg px-1.5 py-px font-mono text-[11px] font-semibold uppercase tracking-[0.08em] text-reject"
          >
            NOT
          </span>
        ) : (
          <>
            <Segmented
              value={node.operator as 'AND' | 'OR'}
              options={[
                { value: 'AND', label: 'Match ALL' },
                { value: 'OR', label: 'Match ANY' },
              ]}
              onChange={(operator) => onChange({ ...node, operator, children })}
            />
            <span className="hidden text-xs text-ink-soft sm:inline">
              {node.operator === 'AND'
                ? '— every line below must be true'
                : '— one true line below is enough'}
            </span>
          </>
        )}
        {!isNot && (
          <label
            title="Flip this group — it will match when the conditions inside do NOT."
            className="ml-1 flex cursor-pointer items-center gap-1 text-sm text-ink-soft transition-colors hover:text-ink"
          >
            <input
              type="checkbox"
              checked={false}
              onChange={() => onChange({ operator: 'NOT', children: [node] })}
            />
            Negate
          </label>
        )}
        {isNot && (
          <Button
            variant="ghost"
            className="h-7 text-sm"
            onClick={() => onChange(children[0] ?? emptyComparison())}
          >
            Remove NOT
          </Button>
        )}
        <span className="flex-1" />
        {onRemove && (
          <Button
            variant="ghost"
            onClick={onRemove}
            aria-label="Remove group"
            className="h-7 px-1.5"
          >
            <Trash2 size={14} />
          </Button>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        {children.map((child, index) => (
          <div
            key={index}
            className="animate-line-in flex items-start gap-1.5"
            style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }}
          >
            {/* Connector rail — rows read as a sentence: if … and … or … */}
            <span
              aria-hidden
              className={cn(
                'mt-2.5 w-9 shrink-0 select-none text-right font-mono text-[11px] font-bold uppercase tracking-[0.08em]',
                index === 0
                  ? 'text-ink-soft/70'
                  : node.operator === 'OR'
                    ? 'text-pending'
                    : 'text-brand',
              )}
            >
              {index === 0 ? (isNot ? 'not' : 'if') : node.operator === 'OR' ? 'or' : 'and'}
            </span>
            <div className="min-w-0 flex-1">
              <ConditionGroup
                node={child}
                path={`${path}[${index}]`}
                fields={fields}
                lists={lists}
                depth={depth + 1}
                onChange={(next) => setChild(index, next)}
                onRemove={() => removeChild(index)}
              />
            </div>
          </div>
        ))}
      </div>

      {!isNot && (
        <div className="mt-2.5 flex gap-2 pl-[42px]">
          <Button
            variant="ghost"
            className="h-7 border border-dashed border-rule px-2.5 text-sm hover:border-brand hover:bg-brand-bg hover:text-brand"
            onClick={() => onChange({ ...node, children: [...children, emptyComparison()] })}
          >
            <Plus size={13} /> Add condition
          </Button>
          <Button
            variant="ghost"
            title="A nested group lets you mix ALL and ANY logic"
            className="h-7 border border-dashed border-rule px-2.5 text-sm hover:border-brand hover:bg-brand-bg hover:text-brand"
            onClick={() => onChange({ ...node, children: [...children, emptyGroup()] })}
          >
            <Plus size={13} /> Add nested group
          </Button>
        </div>
      )}
      {depth >= 3 && (
        <p className="mt-2 text-sm text-ink-soft">
          Consider a decision table for rules this complex.
        </p>
      )}
    </div>
  );
}
