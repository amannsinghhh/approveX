import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { ConditionNode } from '@approvex/shared';
import { isLogicalNode } from '@approvex/shared';
import { PageHeader } from '../components/AppShell';
import { operatorLabel } from '../components/condition-builder';
import { EmptyState } from '../components/EmptyState';
import { StatStrip } from '../components/layout';
import { LedgerTable } from '../components/LedgerTable';
import { MonoId } from '../components/MonoId';
import { StampChip } from '../components/StampChip';
import { Button } from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { timeAgo } from '../lib/format';
import type { Paginated, Rule } from '../lib/types';

function fmtValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '…';
  if (Array.isArray(value)) return value.slice(0, 3).map(fmtValue).join(', ');
  if (typeof value === 'object') return '…';
  return String(value);
}

/**
 * One-line plain-English digest of a condition AST — the list page answers
 * "what does this rule do?" without a click into the builder.
 */
function conditionSummary(ast: ConditionNode | null | undefined): string | null {
  if (!ast) return null;
  const leaves: string[] = [];
  const walk = (node: ConditionNode): void => {
    if (isLogicalNode(node)) node.children.forEach(walk);
    else leaves.push(`${node.field || '…'} ${operatorLabel(node.operator)} ${fmtValue(node.value)}`);
  };
  walk(ast);
  const [first] = leaves;
  if (first === undefined) return null;
  const rest = leaves.length - 1;
  return rest > 0 ? `${first}  ·  +${rest} more` : first;
}

export function RulesListPage(): React.JSX.Element {
  const [rules, setRules] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'published' | 'draft' | null>(null);
  const navigate = useNavigate();
  const { can } = useAuth();

  useEffect(() => {
    api<Paginated<Rule>>('/rules?pageSize=100')
      .then((res) => setRules(res.items))
      .catch(() => setError("Couldn't load rules. Check your connection and retry."))
      .finally(() => setLoading(false));
  }, []);

  const stats = useMemo(() => {
    const published = rules.filter((rule) => rule.status === 'published').length;
    const drafts = rules.filter((rule) => rule.status === 'draft').length;
    const contexts = new Set(rules.map((rule) => rule.context)).size;
    return { published, drafts, contexts };
  }, [rules]);

  const visible = useMemo(
    () => (statusFilter ? rules.filter((rule) => rule.status === statusFilter) : rules),
    [rules, statusFilter],
  );

  return (
    <>
      <PageHeader
        title="Rules"
        subtitle="A rule watches every evaluation call — when its condition matches an incoming payload, it fires and routes the request for approval."
        actions={
          can('rule:create') && (
            <Button variant="primary" onClick={() => navigate('/rules/new')}>
              New rule
            </Button>
          )
        }
      />

      {/* §3.1/§4: flush stat strip — tiles are filters, click toggles. */}
      <StatStrip
        items={[
          {
            key: 'live',
            label: 'Live rules',
            tone: 'approve',
            value: loading ? '—' : stats.published,
            hint: 'published and matching now',
            active: statusFilter === 'published',
            onClick: () => setStatusFilter((f) => (f === 'published' ? null : 'published')),
          },
          {
            key: 'drafts',
            label: 'Drafts',
            tone: 'pending',
            value: loading ? '—' : stats.drafts,
            hint: 'saved but not yet published',
            active: statusFilter === 'draft',
            onClick: () => setStatusFilter((f) => (f === 'draft' ? null : 'draft')),
          },
          {
            key: 'contexts',
            label: 'Contexts covered',
            tone: 'brand',
            value: loading ? '—' : stats.contexts,
            hint: 'distinct evaluation entry points',
          },
          {
            key: 'total',
            label: 'Total rules',
            value: loading ? '—' : rules.length,
            hint: 'across every status',
            active: false,
            onClick: () => setStatusFilter(null),
          },
        ]}
      />

      {error && <p className="mb-4 text-base text-reject">{error}</p>}
      <LedgerTable
        columns={[
          {
            key: 'name',
            header: 'Rule',
            render: (rule) => {
              const summary = conditionSummary(rule.latestVersion?.conditionAst);
              return (
                <span className="block py-1.5">
                  <span className="flex items-center gap-2 font-medium text-ink">
                    {rule.name}
                    <MonoId value={rule.id} />
                  </span>
                  {/* §4 hover preview: truncated digest expands via title. */}
                  <span
                    className="mt-0.5 block truncate font-mono text-xs text-ink-soft"
                    title={summary ?? undefined}
                  >
                    {summary ?? (rule.latestVersion?.ruleType === 'scoring'
                      ? 'scoring rule — weighted factors vs. threshold'
                      : 'no condition yet')}
                  </span>
                </span>
              );
            },
          },
          {
            key: 'context',
            header: 'Context',
            render: (rule) => <span className="font-mono text-sm">{rule.context}</span>,
          },
          {
            key: 'priority',
            header: 'Priority',
            numeric: true,
            render: (rule) => rule.latestVersion?.priority ?? '—',
          },
          {
            key: 'version',
            header: 'Version',
            numeric: true,
            render: (rule) => (rule.currentVersion > 0 ? `v${rule.currentVersion}` : 'unpublished'),
          },
          {
            key: 'updated',
            header: 'Updated',
            render: (rule) => (
              <span className="whitespace-nowrap text-sm text-ink-soft">
                {timeAgo(rule.updatedAt)}
              </span>
            ),
          },
          { key: 'status', header: 'Status', render: (rule) => <StampChip label={rule.status} /> },
        ]}
        rows={visible}
        rowKey={(rule) => rule.id}
        onRowClick={(rule) => navigate(`/rules/${rule.id}`)}
        loading={loading}
        empty={
          <EmptyState
            headline="No rules yet"
            body="A rule matches incoming payloads and routes them to an approval workflow. Create the first one to get started."
            action={
              can('rule:create') && (
                <Button variant="primary" onClick={() => navigate('/rules/new')}>
                  New rule
                </Button>
              )
            }
          />
        }
      />
      <p className="mt-3 text-sm text-ink-soft">
        Rules run against{' '}
        <Link to="/sandbox" className="text-brand">
          the sandbox
        </Link>{' '}
        with zero side effects — publish, then dry-run a payload.
      </p>
    </>
  );
}
