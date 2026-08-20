/**
 * Analytics (Phase 7): the tenant's approval operation at a glance — volume,
 * approval rate, time-to-decision, SLA health, top rules, webhook delivery.
 * Charts are hand-rolled SVG in the ledger aesthetic (no chart library).
 */
import { useCallback, useEffect, useState } from 'react';
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

/** Animated ring showing a percentage — the approval-rate hero graphic. */
function Donut({ pct }: { pct: number }): React.JSX.Element {
  const animated = useCountUp(pct);
  const r = 52;
  const c = 2 * Math.PI * r;
  const dash = (Math.max(0, Math.min(100, animated)) / 100) * c;
  return (
    <div className="relative h-[128px] w-[128px] shrink-0">
      <svg viewBox="0 0 128 128" className="h-full w-full -rotate-90">
        <defs>
          <linearGradient id="ring-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--stamp-approve)" />
            <stop offset="100%" stopColor="var(--brand)" />
          </linearGradient>
        </defs>
        <circle cx="64" cy="64" r={r} fill="none" stroke="var(--rule)" strokeWidth="12" />
        <circle
          cx="64"
          cy="64"
          r={r}
          fill="none"
          stroke="url(#ring-grad)"
          strokeWidth="12"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${c}`}
          style={{ filter: 'drop-shadow(0 2px 6px rgba(14,122,77,0.35))' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-mono text-2xl font-semibold text-ink">{Math.round(animated)}%</span>
        <span className="text-[10px] uppercase tracking-wide text-ink-soft">approved</span>
      </div>
    </div>
  );
}

function humanHours(hours: number | null): string {
  if (hours === null) return '—';
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 48) return `${hours}h`;
  return `${Math.round((hours / 24) * 10) / 10}d`;
}

/** Grouped daily bars: created (neutral), approved (green), rejected (red). */
function VolumeChart({ byDay }: { byDay: Summary['byDay'] }): React.JSX.Element {
  const width = 760;
  const height = 160;
  const max = Math.max(...byDay.map((d) => d.created), 1);
  const slot = width / Math.max(byDay.length, 1);
  const barWidth = Math.min(Math.max(slot * 0.22, 3), 16);

  const series = [
    { id: 'neutral', from: 'var(--stamp-neutral)', to: 'rgba(71,84,103,0.35)' },
    { id: 'approve', from: 'var(--stamp-approve)', to: 'rgba(14,122,77,0.35)' },
    { id: 'reject', from: 'var(--stamp-reject)', to: 'rgba(180,35,24,0.35)' },
  ];

  return (
    <svg
      viewBox={`0 0 ${width} ${height + 24}`}
      className="w-full"
      role="img"
      aria-label="Daily request volume"
    >
      <defs>
        {series.map((s) => (
          <linearGradient key={s.id} id={`bar-${s.id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={s.from} />
            <stop offset="100%" stopColor={s.to} />
          </linearGradient>
        ))}
      </defs>
      {[0.25, 0.5, 0.75, 1].map((fraction) => (
        <line
          key={fraction}
          x1={0}
          x2={width}
          y1={height - height * fraction}
          y2={height - height * fraction}
          stroke="var(--rule)"
          strokeWidth={1}
        />
      ))}
      {byDay.map((day, index) => {
        const x = index * slot + slot / 2;
        const bars: { value: number; fill: string; offset: number }[] = [
          { value: day.created, fill: 'url(#bar-neutral)', offset: -barWidth - 1 },
          { value: day.approved, fill: 'url(#bar-approve)', offset: 0 },
          { value: day.rejected, fill: 'url(#bar-reject)', offset: barWidth + 1 },
        ];
        return (
          <g key={day.date}>
            {bars.map((bar, barIndex) => (
              <rect
                key={barIndex}
                className="animate-bar"
                // draw left-to-right: each day slightly later than the last
                style={{ animationDelay: `${index * 22 + barIndex * 40}ms` }}
                x={x + bar.offset - barWidth / 2}
                y={height - (bar.value / max) * height}
                width={barWidth}
                height={(bar.value / max) * height}
                fill={bar.fill}
                opacity={bar.value === 0 ? 0 : 1}
                rx={Math.min(barWidth / 2, 3)}
              />
            ))}
            {(byDay.length <= 14 || index % Math.ceil(byDay.length / 10) === 0) && (
              <text
                x={x}
                y={height + 16}
                textAnchor="middle"
                className="fill-ink-soft"
                style={{ font: '10px var(--font-data)' }}
              >
                {day.date.slice(5)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
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
        <div className="flex max-w-[980px] flex-col gap-4">
          {/* §4: flush stat strip with 7-day-style sparklines from byDay. */}
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
                key: 'sla',
                label: 'SLA breaches',
                value: <Count n={summary.slaBreaches} />,
                hint: `${summary.escalations} escalated`,
                tone: summary.slaBreaches > 0 ? 'reject' : 'approve',
                spark: summary.byDay.map((d) => d.rejected),
              },
            ]}
          />

          <Card className="card-elevated flex gap-6 p-4">
            {summary.approvalRatePct !== null && (
              <div className="flex shrink-0 flex-col items-center justify-center border-r border-rule pr-6">
                <Donut pct={summary.approvalRatePct} />
                <p className="mt-2 text-center text-xs text-ink-soft">
                  {summary.totals.approved} approved
                  <br />
                  {summary.totals.rejected} rejected
                </p>
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="mb-2 flex items-center gap-4">
                <p className="text-base font-medium text-ink">Daily volume</p>
                <span className="flex items-center gap-1.5 text-xs text-ink-soft">
                  <span className="inline-block h-2 w-2 rounded-[2px] bg-neutral" /> created
                  <span className="ml-2 inline-block h-2 w-2 rounded-[2px] bg-approve" /> approved
                  <span className="ml-2 inline-block h-2 w-2 rounded-[2px] bg-reject" /> rejected
                </span>
              </div>
              {summary.byDay.length === 0 ? (
                <p className="py-10 text-center text-base text-ink-soft">
                  No requests in this window yet — run one through{' '}
                  <span className="font-mono">POST /evaluate</span>.
                </p>
              ) : (
                <VolumeChart byDay={summary.byDay} />
              )}
            </div>
          </Card>

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
