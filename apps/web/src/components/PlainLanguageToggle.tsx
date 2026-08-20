/**
 * Part A plain-language pane (guided-UI layer): renders a condition AST as
 * readable sentences ("ALL of these are true: amount is more than 500000 …"),
 * with a toggle to the raw JSON for engineers. Read-only — editing happens in
 * the builder; this pane answers "what does this rule actually mean?".
 */
import { useState } from 'react';
import type { ComparisonNode, ConditionNode } from '@approvex/shared';
import { isLogicalNode } from '@approvex/shared';
import { Segmented } from './ui';

function fmt(value: unknown): string {
  if (Array.isArray(value)) return value.map(fmt).join(', ');
  if (typeof value === 'string') return value === '' ? '…' : `"${value}"`;
  if (value === null || value === undefined) return '…';
  return String(value);
}

function pair(value: unknown): [string, string] {
  const [a, b] = Array.isArray(value) ? value : [undefined, undefined];
  return [fmt(a), fmt(b)];
}

/** The sentence fragment after the field name. */
function phrase(node: ComparisonNode): string {
  const value =
    node.valueType === 'field'
      ? `the value of ${typeof node.value === 'string' && node.value ? node.value : '…'}`
      : fmt(node.value);

  switch (node.operator) {
    case '=':
      return `is ${value}`;
    case '!=':
      return `is not ${value}`;
    case '>':
      return `is more than ${value}`;
    case '>=':
      return `is at least ${value}`;
    case '<':
      return `is less than ${value}`;
    case '<=':
      return `is at most ${value}`;
    case 'IN':
      return `is one of ${value}`;
    case 'NOT_IN':
      return `is none of ${value}`;
    case 'IN_IGNORE_CASE':
      return `is one of ${value} (ignoring case)`;
    case 'IN_LIST':
      return `is in the managed list ${value}`;
    case 'NOT_IN_LIST':
      return `is not in the managed list ${value}`;
    case 'BETWEEN': {
      const [low, high] = pair(node.value);
      return `is between ${low} and ${high}`;
    }
    case 'NOT_BETWEEN': {
      const [low, high] = pair(node.value);
      return `is outside ${low} to ${high}`;
    }
    case 'MULTIPLE_OF':
      return `is a multiple of ${value}`;
    case 'WITHIN_PERCENT_OF': {
      const v = (node.value ?? {}) as { percent?: number; of?: string };
      return `is within ${v.percent ?? '…'}% of ${v.of || '…'}`;
    }
    case 'CONTAINS':
      return `contains ${value}`;
    case 'NOT_CONTAINS':
      return `does not contain ${value}`;
    case 'STARTS_WITH':
      return `starts with ${value}`;
    case 'ENDS_WITH':
      return `ends with ${value}`;
    case 'MATCHES_REGEX':
      return `matches the pattern ${value}`;
    case 'EQUALS_IGNORE_CASE':
      return `equals ${value} (ignoring case)`;
    case 'IS_EMPTY':
      return 'is empty';
    case 'IS_NOT_EMPTY':
      return 'is not empty';
    case 'BEFORE':
      return `is before ${value}`;
    case 'AFTER':
      return `is after ${value}`;
    case 'ON':
      return `is on ${value}`;
    case 'WITHIN_LAST_N_DAYS':
      return `is within the last ${fmt(node.value)} days`;
    case 'WITHIN_NEXT_N_DAYS':
      return `is within the next ${fmt(node.value)} days`;
    case 'OLDER_THAN_N_DAYS':
      return `is more than ${fmt(node.value)} days old`;
    case 'DAY_OF_WEEK_IN':
      return `falls on ${value}`;
    case 'TIME_OF_DAY_BETWEEN': {
      const [from, to] = pair(node.value);
      return `is between ${from} and ${to} (time of day)`;
    }
    case 'CONTAINS_ALL':
      return `contains all of ${value}`;
    case 'CONTAINS_ANY':
      return `contains any of ${value}`;
    case 'LENGTH_EQ':
      return `has exactly ${fmt(node.value)} items`;
    case 'LENGTH_GT':
      return `has more than ${fmt(node.value)} items`;
    case 'LENGTH_LT':
      return `has fewer than ${fmt(node.value)} items`;
    case 'ANY_ITEM_MATCHES':
      return 'has at least one item matching the nested condition';
    case 'ALL_ITEMS_MATCH':
      return 'has every item matching the nested condition';
    case 'IS_NULL':
      return 'is null';
    case 'IS_NOT_NULL':
      return 'is not null';
    case 'EXISTS':
      return 'is present in the payload';
    case 'NOT_EXISTS':
      return 'is absent from the payload';
    default:
      return `${node.operator} ${value}`;
  }
}

function NodeView({ node }: { node: ConditionNode }): React.JSX.Element {
  if (!isLogicalNode(node)) {
    return (
      <p className="text-sm leading-6 text-ink">
        <span className="font-mono text-brand">{node.field || '(pick a field)'}</span>{' '}
        {phrase(node)}
      </p>
    );
  }
  const heading =
    node.operator === 'AND'
      ? 'ALL of these are true:'
      : node.operator === 'OR'
        ? 'AT LEAST ONE of these is true:'
        : 'This must NOT be true:';
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">{heading}</p>
      <ul className="mt-1 flex flex-col gap-1 border-l-2 border-rule pl-3">
        {node.children.length === 0 && (
          <li className="text-sm text-ink-soft">(empty group — always true)</li>
        )}
        {node.children.map((child, index) => (
          <li key={index}>
            <NodeView node={child} />
          </li>
        ))}
      </ul>
    </div>
  );
}

export function PlainLanguageToggle({
  node,
  className,
}: {
  node: ConditionNode;
  className?: string;
}): React.JSX.Element {
  const [view, setView] = useState<'plain' | 'json'>('plain');
  return (
    <div className={className}>
      <Segmented
        value={view}
        options={[
          { value: 'plain', label: 'Plain language' },
          { value: 'json', label: 'JSON' },
        ]}
        onChange={setView}
      />
      {view === 'plain' ? (
        <div className="mt-3 rounded-[10px] border border-rule bg-surface p-4">
          <NodeView node={node} />
        </div>
      ) : (
        <pre className="mt-3 overflow-x-auto rounded-[10px] border border-rule bg-surface p-4 font-mono text-sm leading-5 text-ink">
          {JSON.stringify(node, null, 2)}
        </pre>
      )}
    </div>
  );
}
