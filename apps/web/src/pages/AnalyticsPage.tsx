/**
 * Analytics (Phase 7, visual rebuild): the tenant's approval operation at a
 * glance — volume, approval rate, time-to-decision, SLA health, and the
 * per-step bottleneck view. Charts are recharts on the token palette; the
 * series colors (brand / approve / reject) are validated for CVD separation
 * with legend + direct labels as secondary encoding.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { PageHeader } from '../components/AppShell';
import { StatStrip } from '../components/layout';
import { LedgerTable } from '../components/LedgerTable';
import { StampChip } from '../components/StampChip';
import { Card, Segmented } from '../components/ui';
import { api } from '../lib/api';
import { timeAgo } from '../lib/format';
import { useCountUp } from '../lib/motion';

interface Summary {
  windowDays: number;
  totals: { total: number; pending: number; approved: number; rejected: number; cancelled: number };
  approvalRatePct: number | null;
  avgDecisionHours: number | null;
  medianDecisionHours: number | null;
  slaBreaches: number;
  escalations: number;
  byDay: { date: string; created: number; approved: number; rejected: number }[];
  bySteps: {
    nodeId: string;
    count: number;
    avgHours: number | null;
    escalations: number;
    slaBreaches: number;
  }[];
  topRules: { ruleId: string; name: string; version: number; count: number }[];
  byContext: { context: string; count: number }[];
  webhooks: { delivered: number; pending: number; deadLettered: number };
}

/** Compact audit trail for the info layer (§4): what just happened, quietly. */
interface ActivityEvent {
  id: string;
  eventType: string;
  occurredAt: string;
}

/** A figure that ticks up from zero when it lands — a settling counter. */
function Count({ n, suffix = '' }: { n: number; suffix?: string }): React.JSX.Element {
  const value = useCountUp(n);
  return (
    <>
      {value}
      {suffix}
    </>
  );
}

function humanHours(hours: number | null): string {
  if (hours === null) return '—';
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 48) return `${hours}h`;
  return `${Math.round((hours / 24) * 10) / 10}d`;
}

/** Shared axis/grid styling — recessive, mono, token inks. */
const AXIS_TICK = { fontFamily: 'var(--font-data)', fontSize: 10, fill: 'var(--ink-soft)' };
const TOOLTIP_STYLE: React.CSSProperties = {
  background: 'var(--surface)',
  border: '1px solid var(--rule)',
  borderRadius: 8,
  fontFamily: 'var(--font-data)',
  fontSize: 12,
  color: 'var(--ink)',
  boxShadow: 'var(--shadow-md)',
};
const LEGEND_STYLE: React.CSSProperties = {
  fontFamily: 'var(--font-ui)',
  fontSize: 12,
  color: 'var(--ink-soft)',
};

function ChartCard({
  title,
  hint,
  children,
  className,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}): React.JSX.Element {
  return (
    <Card className={`card-elevated min-w-0 p-4 ${className ?? ''}`}>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <p className="text-base font-medium text-ink">{title}</p>
        {hint && <p className="truncate text-xs text-ink-soft">{hint}</p>}
      </div>
      {children}
    </Card>
  );
}

function EmptyChart(): React.JSX.Element {
  return (
    <p className="py-10 text-center text-base text-ink-soft">
      No requests in this window yet — run one through{' '}
      <span className="font-mono">POST /evaluate</span>.
    </p>
  );
}

export function AnalyticsPage(): React.JSX.Element {
  const [days, setDays] = useState<'7' | '30' | '90'>('30');
  const [summary, setSummary] = useState<Summary | null>(null);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);

  const load = useCallback(async () => {
    setSummary(await api<Summary>(`/analytics/summary?days=${days}`));
  }, [days]);

  useEffect(() => {
    void load();
  }, [load]);

  // Activity feed (§4). Best-effort — hidden for roles without audit access.
  useEffect(() => {
    api<{ items: ActivityEvent[] }>('/audit?page=1&pageSize=8')
      .then((res) => setActivity(res.items))
      .catch(() => setActivity([]));
  }, []);

  const bySteps = summary?.bySteps ?? [];
  const totalSteps = bySteps.reduce((sum, step) => sum + step.count, 0);
  const escalationRatePct =
    summary && totalSteps > 0 ? Math.round((summary.escalations / totalSteps) * 1000) / 10 : null;

  /** Daily approval rate — null on days without decisions (line skips them). */
  const rateByDay = (summary?.byDay ?? []).map((day) => {
    const decided = day.approved + day.rejected;
    return {
      date: day.date,
      rate: decided > 0 ? Math.round((day.approved / decided) * 1000) / 10 : null,
    };
  });

  /** Bottleneck data: slowest steps first; the worst one gets the emphasis hue. */
  const stepTimes = bySteps
    .filter((step) => step.avgHours !== null)
    .sort((a, b) => (b.avgHours ?? 0) - (a.avgHours ?? 0))
    .slice(0, 8);

  return (
    <>
      <PageHeader
        title="Analytics"
        actions={
          <Segmented
            value={days}
            options={[
              { value: '7', label: '7 days' },
              { value: '30', label: '30 days' },
              { value: '90', label: '90 days' },
            ]}
            onChange={setDays}
          />
        }
      >
        <p className="mt-1 text-sm text-ink-soft">Your approval operation, at a glance.</p>
      </PageHeader>

      {!summary ? (
        <div className="flex flex-col gap-4">
          <div className="shimmer h-24 rounded-[10px] bg-rule/40" />
          <div
            className="shimmer h-48 rounded-[10px] bg-rule/40"
            style={{ animationDelay: '120ms' }}
          />
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {/* §4: flush stat strip with sparklines from byDay. */}
          <StatStrip
            className="mb-0"
            items={[
              {
                key: 'requests',
                label: 'Requests',
                value: <Count n={summary.totals.total} />,
                hint: `${summary.totals.pending} pending now`,
                tone: 'brand',
                spark: summary.byDay.map((d) => d.created),
              },
              {
                key: 'rate',
                label: 'Approval rate',
                value:
                  summary.approvalRatePct !== null ? (
                    <Count n={summary.approvalRatePct} suffix="%" />
                  ) : (
                    '—'
                  ),
                hint: `${summary.totals.approved} approved · ${summary.totals.rejected} rejected`,
                tone: 'approve',
                spark: summary.byDay.map((d) => d.approved),
              },
              {
                key: 'ttd',
                label: 'Time to decision',
                value: humanHours(summary.medianDecisionHours),
                hint: `median · avg ${humanHours(summary.avgDecisionHours)}`,
                tone: 'pending',
              },
              {
                key: 'esc',
                label: 'Escalation rate',
                value: escalationRatePct !== null ? <Count n={escalationRatePct} suffix="%" /> : '—',
                hint: `${summary.escalations} of ${totalSteps} steps escalated`,
                tone: summary.escalations > 0 ? 'pending' : 'approve',
              },
              {
                key: 'sla',
                label: 'SLA breaches',
                value: <Count n={summary.slaBreaches} />,
                hint: summary.slaBreaches > 0 ? 'steps past their SLA' : 'all within SLA',
                tone: summary.slaBreaches > 0 ? 'reject' : 'approve',
              },
            ]}
          />

          <div className="grid gap-4 xl:grid-cols-5">
            <ChartCard
              title="Daily volume"
              hint="created vs decided, per day"
              className="xl:col-span-3"
            >
              {summary.byDay.length === 0 ? (
                <EmptyChart />
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={summary.byDay} barGap={2} barCategoryGap="24%">
                    <CartesianGrid vertical={false} stroke="var(--rule)" />
                    <XAxis
                      dataKey="date"
                      tick={AXIS_TICK}
                      tickFormatter={(d: string) => d.slice(5)}
                      axisLine={{ stroke: 'var(--rule)' }}
                      tickLine={false}
                    />
                    <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={28} allowDecimals={false} />
                    <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: 'var(--brand-bg)' }} />
                    <Legend wrapperStyle={LEGEND_STYLE} iconSize={9} />
                    <Bar dataKey="created" name="created" fill="var(--brand)" radius={[3, 3, 0, 0]} />
                    <Bar
                      dataKey="approved"
                      name="approved"
                      fill="var(--stamp-approve)"
                      radius={[3, 3, 0, 0]}
                    />
                    <Bar
                      dataKey="rejected"
                      name="rejected"
                      fill="var(--stamp-reject)"
                      radius={[3, 3, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </ChartCard>

            <ChartCard
              title="Approval rate over time"
              hint={
                summary.approvalRatePct !== null
                  ? `${summary.approvalRatePct}% across the window`
                  : undefined
              }
              className="xl:col-span-2"
            >
              {rateByDay.every((d) => d.rate === null) ? (
                <EmptyChart />
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={rateByDay}>
                    <CartesianGrid vertical={false} stroke="var(--rule)" />
                    <XAxis
                      dataKey="date"
                      tick={AXIS_TICK}
                      tickFormatter={(d: string) => d.slice(5)}
                      axisLine={{ stroke: 'var(--rule)' }}
                      tickLine={false}
                    />
                    <YAxis
                      tick={AXIS_TICK}
                      axisLine={false}
                      tickLine={false}
                      width={34}
                      domain={[0, 100]}
                      tickFormatter={(v: number) => `${v}%`}
                    />
                    <Tooltip
                      contentStyle={TOOLTIP_STYLE}
                      formatter={(value) => [`${String(value)}%`, 'approved']}
                    />
                    <Line
                      type="monotone"
                      dataKey="rate"
                      stroke="var(--brand)"
                      strokeWidth={2}
                      connectNulls
                      dot={{ r: 2.5, fill: 'var(--brand)', strokeWidth: 0 }}
                      activeDot={{ r: 4 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </ChartCard>
          </div>

          <div className="grid gap-4 xl:grid-cols-5">
            <ChartCard
              title="Time to approve, per step"
              hint="slowest step is your bottleneck"
              className="xl:col-span-3"
            >
              {stepTimes.length === 0 ? (
                <p className="py-10 text-center text-base text-ink-soft">
                  No completed steps in this window yet.
                </p>
              ) : (
                <ResponsiveContainer width="100%" height={Math.max(140, stepTimes.length * 36 + 40)}>
                  <BarChart data={stepTimes} layout="vertical" barCategoryGap="28%">
                    <CartesianGrid horizontal={false} stroke="var(--rule)" />
                    <XAxis
                      type="number"
                      tick={AXIS_TICK}
                      axisLine={{ stroke: 'var(--rule)' }}
                      tickLine={false}
                      tickFormatter={(v: number) => `${v}h`}
                    />
                    <YAxis
                      type="category"
                      dataKey="nodeId"
                      tick={AXIS_TICK}
                      axisLine={false}
                      tickLine={false}
                      width={140}
                    />
                    <Tooltip
                      contentStyle={TOOLTIP_STYLE}
                      cursor={{ fill: 'var(--brand-bg)' }}
                      formatter={(value) => [humanHours(Number(value)), 'avg time']}
                    />
                    <Bar dataKey="avgHours" radius={[0, 3, 3, 0]}>
                      {/* Emphasis form: the bottleneck carries the warning hue,
                          the rest recede to neutral. */}
                      {stepTimes.map((step, index) => (
                        <Cell
                          key={step.nodeId}
                          fill={index === 0 ? 'var(--stamp-pending)' : 'var(--stamp-neutral)'}
                          opacity={index === 0 ? 1 : 0.55}
                        />
                      ))}
                      <LabelList
                        dataKey="avgHours"
                        position="right"
                        formatter={(v) => humanHours(Number(v))}
                        style={{ ...AXIS_TICK, fill: 'var(--ink)' }}
                      />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </ChartCard>

            <div className="min-w-0 xl:col-span-2">
              <p className="mb-2 text-base font-medium text-ink">Step health</p>
              <LedgerTable<Summary['bySteps'][number]>
                columns={[
                  {
                    key: 'step',
                    header: 'Step',
                    render: (s) => <span className="font-mono text-sm">{s.nodeId}</span>,
                  },
                  { key: 'count', header: 'Steps', numeric: true, render: (s) => s.count },
                  {
                    key: 'avg',
                    header: 'Avg time',
                    numeric: true,
                    render: (s) => humanHours(s.avgHours),
                  },
                  {
                    key: 'esc',
                    header: 'Escalated',
                    numeric: true,
                    render: (s) =>
                      s.escalations > 0 ? (
                        <span className="text-pending">{s.escalations}</span>
                      ) : (
                        0
                      ),
                  },
                  {
                    key: 'sla',
                    header: 'Breaches',
                    numeric: true,
                    render: (s) =>
                      s.slaBreaches > 0 ? <span className="text-reject">{s.slaBreaches}</span> : 0,
                  },
                ]}
                rows={bySteps}
                rowKey={(s) => s.nodeId}
                empty={
                  <p className="text-center text-base text-ink-soft">No steps in this window.</p>
                }
              />
            </div>
          </div>

          <div className="flex gap-4">
            <div className="min-w-0 flex-1">
              <p className="mb-2 text-base font-medium text-ink">Top matched rules</p>
              <LedgerTable<Summary['topRules'][number]>
                columns={[
                  {
                    key: 'rule',
                    header: 'Rule',
                    render: (r) => (
                      <span>
                        {r.name}{' '}
                        <span className="font-mono text-xs text-ink-soft">v{r.version}</span>
                      </span>
                    ),
                  },
                  { key: 'count', header: 'Requests', numeric: true, render: (r) => r.count },
                ]}
                rows={summary.topRules}
                rowKey={(r) => `${r.ruleId}-${r.version}`}
                empty={<p className="text-center text-base text-ink-soft">No matches yet.</p>}
              />
            </div>
            <div className="min-w-0 flex-1">
              <p className="mb-2 text-base font-medium text-ink">By context</p>
              <LedgerTable<Summary['byContext'][number]>
                columns={[
                  {
                    key: 'context',
                    header: 'Context',
                    render: (c) => <span className="font-mono text-sm">{c.context}</span>,
                  },
                  { key: 'count', header: 'Requests', numeric: true, render: (c) => c.count },
                ]}
                rows={summary.byContext}
                rowKey={(c) => c.context}
                empty={<p className="text-center text-base text-ink-soft">No requests yet.</p>}
              />
            </div>
            <div className="w-[240px] shrink-0">
              <p className="mb-2 text-base font-medium text-ink">Webhook health</p>
              <Card className="flex flex-col gap-2 p-3">
                <div className="flex items-center justify-between">
                  <StampChip label="delivered" tone="approve" />
                  <span className="font-mono text-sm">{summary.webhooks.delivered}</span>
                </div>
                <div className="flex items-center justify-between">
                  <StampChip label="pending" tone="pending" />
                  <span className="font-mono text-sm">{summary.webhooks.pending}</span>
                </div>
                <div className="flex items-center justify-between">
                  <StampChip label="dead letter" tone="reject" />
                  <span className="font-mono text-sm">{summary.webhooks.deadLettered}</span>
                </div>
              </Card>
              {activity.length > 0 && (
                <>
                  <p className="mb-2 mt-4 text-base font-medium text-ink">Recent activity</p>
                  <div className="flex flex-col divide-y divide-rule rounded-[10px] border border-rule bg-surface">
                    {activity.map((event) => (
                      <div key={event.id} className="px-3 py-1.5">
                        <p className="truncate font-mono text-xs text-ink">{event.eventType}</p>
                        <p className="text-xs text-ink-soft">{timeAgo(event.occurredAt)}</p>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
