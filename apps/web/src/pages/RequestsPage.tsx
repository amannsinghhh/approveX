/**
 * Requests explorer (UI spec §5.5, restructure §3.5): pure ledger, edge-to-edge.
 * Filters live inline in the 48px toolbar — no separate filter card — and the
 * table fills a full-height frame with a sticky header. Filters persist in the
 * URL; row click opens the detail drawer over the right 40% (?request= deep
 * link), with the list pinned visible behind it.
 */
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { X } from 'lucide-react';
import { PageHeader } from '../components/AppShell';
import { EmptyState } from '../components/EmptyState';
import { KeyboardHintBar } from '../components/layout';
import { LedgerTable } from '../components/LedgerTable';
import { MonoId } from '../components/MonoId';
import { RequestDetail } from '../components/RequestDetail';
import { StampChip } from '../components/StampChip';
import { Button, Input, Select } from '../components/ui';
import { api } from '../lib/api';
import { timeAgo } from '../lib/format';
import type { Paginated, RequestListItem } from '../lib/types';

const CURL_SNIPPET = `curl -X POST https://your-host/api/v1/evaluate \\
  -H 'Authorization: Bearer <token>' -H 'Content-Type: application/json' \\
  -d '{"context":"PAYMENT_APPROVAL","data":{"amount":840000},"mode":"execute"}'`;

export function RequestsPage(): React.JSX.Element {
  const [params, setParams] = useSearchParams();
  const [items, setItems] = useState<RequestListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const status = params.get('status') ?? '';
  const context = params.get('context') ?? '';
  const openRequest = params.get('request');

  const setParam = (key: string, value: string): void => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const query = new URLSearchParams({ pageSize: '100' });
      if (status) query.set('status', status);
      if (context) query.set('context', context);
      const res = await api<Paginated<RequestListItem>>(`/requests?${query.toString()}`);
      setItems(res.items);
      setTotal(res.total);
      setError(null);
    } catch {
      setError("Couldn't load requests. Check your connection and retry.");
    } finally {
      setLoading(false);
    }
  }, [status, context]);

  useEffect(() => {
    void load();
  }, [load]);

  // §4: Esc closes the drawer without reaching for the mouse.
  useEffect(() => {
    if (!openRequest) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setParam('request', '');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openRequest]);

  return (
    <>
      <PageHeader title="Requests" />

      <div className="flex h-[calc(100dvh-96px)] min-h-0 flex-col overflow-hidden rounded-[10px] border border-rule bg-surface elev-sm">
        {/* 48px toolbar: filters inline, count right-aligned (§3.5). */}
        <div className="flex h-12 shrink-0 items-center gap-2 border-b border-rule px-3">
          <label
            htmlFor="f-status"
            className="text-xs font-medium uppercase tracking-[0.06em] text-ink-soft"
          >
            Status
          </label>
          <Select
            id="f-status"
            className="h-8 w-36 text-sm"
            value={status}
            onChange={(e) => setParam('status', e.target.value)}
          >
            <option value="">All</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="cancelled">Cancelled</option>
            <option value="expired">Expired</option>
          </Select>
          <label
            htmlFor="f-context"
            className="ml-2 text-xs font-medium uppercase tracking-[0.06em] text-ink-soft"
          >
            Context
          </label>
          <Input
            id="f-context"
            className="h-8 w-56 font-mono text-sm"
            placeholder="PAYMENT_APPROVAL"
            value={context}
            onChange={(e) => setParam('context', e.target.value.toUpperCase())}
          />
          <span className="flex-1" />
          {error && <p className="text-sm text-reject">{error}</p>}
          <p className="font-mono text-xs text-ink-soft">
            Showing {items.length} of {total}
          </p>
        </div>

        <LedgerTable
          flush
          columns={[
            { key: 'id', header: 'Id', render: (row) => <MonoId value={row.id} /> },
            {
              key: 'title',
              header: 'Title',
              render: (row) => (
                <span className="font-medium text-ink">{row.title ?? row.context ?? '—'}</span>
              ),
            },
            {
              key: 'context',
              header: 'Context',
              render: (row) => <span className="font-mono text-sm">{row.context ?? '—'}</span>,
            },
            {
              key: 'step',
              header: 'Current step',
              render: (row) =>
                row.pendingSteps.length > 0 ? (
                  <span className="font-mono text-sm">
                    {row.pendingSteps.map((step) => step.nodeId).join(', ')}
                  </span>
                ) : (
                  '—'
                ),
            },
            { key: 'status', header: 'Status', render: (row) => <StampChip label={row.status} /> },
            {
              key: 'age',
              header: 'Age',
              numeric: true,
              render: (row) => timeAgo(row.createdAt),
            },
          ]}
          rows={items}
          rowKey={(row) => row.id}
          onRowClick={(row) => setParam('request', row.id)}
          loading={loading}
          empty={
            <EmptyState
              headline="No requests yet"
              body="Your first POST /evaluate with mode execute will appear here."
              action={
                <pre className="max-w-xl overflow-x-auto rounded-[6px] border border-rule bg-paper p-3 text-left font-mono text-xs leading-5 text-ink">
                  {CURL_SNIPPET}
                </pre>
              }
            />
          }
        />
      </div>

      {/* drawer (§3.5): right 40%, over the list — list stays pinned behind. */}
      {openRequest && (
        <div className="fixed inset-0 z-40" role="dialog" aria-label="Request detail">
          <button
            type="button"
            aria-label="Close"
            className="absolute inset-0 bg-ink/10"
            onClick={() => setParam('request', '')}
          />
          <div className="absolute inset-y-0 right-0 flex w-[40vw] min-w-[520px] max-w-full flex-col border-l border-rule bg-surface shadow-2xl">
            <div className="flex justify-end border-b border-rule px-2 py-1.5">
              <Button
                variant="ghost"
                className="h-7 px-1.5"
                aria-label="Close drawer"
                onClick={() => setParam('request', '')}
              >
                <X size={15} />
              </Button>
            </div>
            <div className="min-h-0 flex-1">
              <RequestDetail requestId={openRequest} onChanged={() => void load()} />
            </div>
          </div>
        </div>
      )}

      <KeyboardHintBar
        hints={[
          { keys: '↵', label: 'open row' },
          { keys: 'Esc', label: 'close drawer' },
          { keys: '⌘K', label: 'search' },
        ]}
      />
    </>
  );
}
