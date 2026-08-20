/**
 * Approval Inbox (UI spec §5.1, restructure §3.2): three-pane workbench —
 * flush queue left (320), request detail fluid center, context rail right
 * (300) with why-matched / who's-next / SLA. SLA meters on every row,
 * keyboard J/K/A/R, ALL CLEAR empty state. Approving/rejecting refreshes the
 * list and advances selection.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PageHeader } from '../components/AppShell';
import { ContextRail, KeyboardHintBar, RailSection, ThreePane } from '../components/layout';
import { RequestDetail } from '../components/RequestDetail';
import { SlaMeter } from '../components/SlaMeter';
import { StampChip } from '../components/StampChip';
import { api } from '../lib/api';
import { cn } from '../lib/cn';
import { formatINR, payloadAmount, timeAgo } from '../lib/format';
import type { InboxItem, RequestDetailData } from '../lib/types';

function Avatar({ name }: { name: string }): React.JSX.Element {
  const initials = name
    .split(/\s+/)
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  return (
    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-bg font-mono text-xs font-semibold text-brand">
      {initials || '?'}
    </span>
  );
}

export function InboxPage(): React.JSX.Element {
  const [items, setItems] = useState<InboxItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusReject, setFocusReject] = useState(false);
  const [detail, setDetail] = useState<RequestDetailData | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await api<{ items: InboxItem[] }>('/inbox');
      setItems(res.items);
      setSelectedId((current) =>
        current && res.items.some((item) => item.id === current)
          ? current
          : (res.items[0]?.id ?? null),
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const selected = useMemo(
    () => items.find((item) => item.id === selectedId) ?? null,
    [items, selectedId],
  );

  // Keyboard: J/K move, A approve (via detail's Approve), R open reject.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      const index = items.findIndex((item) => item.id === selectedId);
      if (event.key === 'j' || event.key === 'J') {
        const next = items[Math.min(index + 1, items.length - 1)];
        if (next) setSelectedId(next.id);
      } else if (event.key === 'k' || event.key === 'K') {
        const prev = items[Math.max(index - 1, 0)];
        if (prev) setSelectedId(prev.id);
      } else if (event.key === 'r' || event.key === 'R') {
        setFocusReject(true);
      } else if (event.key === 'a' || event.key === 'A') {
        document.querySelector<HTMLButtonElement>('[data-inbox-approve]')?.click();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [items, selectedId]);

  const why = detail
    ? detail.matchedRule
      ? `Matched rule ${detail.matchedRule.name} (v${detail.matchedRule.version}) → workflow ` +
        `${detail.workflowVersion.workflowName ?? 'unknown'} (v${detail.workflowVersion.version}).`
      : `Created directly against workflow ` +
        `${detail.workflowVersion.workflowName ?? 'unknown'} (v${detail.workflowVersion.version}).`
    : null;

  const queue = (
    <div ref={listRef} className="flex flex-col divide-y divide-rule">
      {loading &&
        Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="shimmer h-20 bg-rule/40" style={{ animationDelay: `${i * 120}ms` }} />
        ))}
      {!loading && items.length === 0 && (
        <div className="animate-card-rise flex flex-col items-center gap-3 px-4 py-14">
          <StampChip label="ALL CLEAR" tone="approve" thump className="scale-150" />
          <p className="mt-2 text-center text-base text-ink-soft">
            Nothing waiting on you. New approvals will appear here.
          </p>
        </div>
      )}
      {items.map((item, i) => {
        const amount = payloadAmount(item.request.payload);
        const active = item.id === selectedId;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => {
              setSelectedId(item.id);
              setFocusReject(false);
            }}
            style={{ animationDelay: `${Math.min(i, 10) * 40}ms` }}
            className={cn(
              'animate-ledger-in relative px-3 py-2.5 text-left transition-colors duration-100',
              active
                ? 'bg-brand-bg/50 shadow-[inset_2px_0_0_var(--brand)]'
                : 'hover:bg-paper/60',
            )}
          >
            <div className="flex items-center gap-2.5">
              <Avatar name={item.request.createdByName ?? '?'} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-base font-medium text-ink">
                  {item.request.title ?? item.request.context ?? 'Request'}
                </p>
                <p className="truncate text-sm text-ink-soft">
                  {item.request.createdByName ?? 'unknown'} · {timeAgo(item.request.createdAt)}
                </p>
              </div>
              <div className="flex flex-col items-end gap-1">
                {amount !== null && (
                  <span className="font-mono text-sm font-medium text-ink">
                    {formatINR(amount)}
                  </span>
                )}
                <StampChip label="pending" />
              </div>
            </div>
            {item.request.context && (
              <p className="mt-1 pl-[38px] font-mono text-xs text-ink-soft">
                {item.request.context} · step {item.nodeId}
              </p>
            )}
            <SlaMeter createdAt={item.createdAt} dueAt={item.dueAt} />
          </button>
        );
      })}
    </div>
  );

  const center = selected ? (
    <RequestDetail
      key={`${selected.request.id}-${focusReject}`}
      requestId={selected.request.id}
      focusReject={focusReject}
      hideWhy
      onDetail={setDetail}
      onChanged={() => {
        setFocusReject(false);
        void load();
      }}
    />
  ) : (
    <div className="flex h-full items-center justify-center">
      <p className="text-base text-ink-soft">
        {loading ? 'Loading…' : 'Select an approval to review it.'}
      </p>
    </div>
  );

  const rail = (
    <ContextRail>
      <RailSection title="Why this matched">
        {why ? (
          <p className="text-sm text-ink">{why}</p>
        ) : (
          <p className="text-sm text-ink-soft">—</p>
        )}
      </RailSection>
      <RailSection title="Waiting on">
        {detail && detail.pendingApprovers.length > 0 ? (
          <ul className="flex flex-col gap-1.5">
            {detail.pendingApprovers.map((approver) => (
              <li key={approver.stepId} className="text-sm text-ink">
                <span className="font-medium">{approver.roleName}</span>
                {approver.eligibleUsers.length > 0 && (
                  <span className="text-ink-soft">
                    {' '}
                    · {approver.eligibleUsers.map((user) => user.name).join(', ')}
                  </span>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink-soft">
            {detail ? 'No pending steps.' : '—'}
          </p>
        )}
      </RailSection>
      {selected && (
        <RailSection title="SLA">
          <SlaMeter createdAt={selected.createdAt} dueAt={selected.dueAt} />
        </RailSection>
      )}
    </ContextRail>
  );

  return (
    <>
      <PageHeader title="Inbox">
        <p className="mt-1 text-sm text-ink-soft">
          {items.length > 0 ? `${items.length} waiting on you` : ' '}
        </p>
      </PageHeader>

      <ThreePane left={queue} center={center} right={rail} leftWidth={320} rightWidth={300} />

      <KeyboardHintBar
        hints={[
          { keys: 'J/K', label: 'navigate' },
          { keys: 'A', label: 'approve' },
          { keys: 'R', label: 'reject' },
        ]}
      />
    </>
  );
}
