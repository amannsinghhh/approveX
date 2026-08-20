/**
 * My requests (/my-requests): the requester's own submissions — what they filed
 * and where each one stands. A read-only ledger; status filter persists in the
 * URL. This is the "track it" half of the self-service portal.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { PageHeader } from '../components/AppShell';
import { EmptyState } from '../components/EmptyState';
import { LedgerTable } from '../components/LedgerTable';
import { MonoId } from '../components/MonoId';
import { StampChip } from '../components/StampChip';
import { Button, Select } from '../components/ui';
import { api } from '../lib/api';
import { timeAgo } from '../lib/format';
import type { MyRequestItem, Paginated } from '../lib/types';

export function MyRequestsPage(): React.JSX.Element {
  const [params, setParams] = useSearchParams();
  const [items, setItems] = useState<MyRequestItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const status = params.get('status') ?? '';

  const setStatus = (value: string): void => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value) next.set('status', value);
        else next.delete('status');
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
      const res = await api<Paginated<MyRequestItem>>(`/portal/my-requests?${query.toString()}`);
      setItems(res.items);
      setTotal(res.total);
      setError(null);
    } catch {
      setError("Couldn't load your requests. Check your connection and retry.");
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <PageHeader
        title="My requests"
        subtitle="Everything you've submitted and where each one stands."
        actions={
          <Link to="/submit">
            <Button variant="primary">
              <Plus size={15} /> New request
            </Button>
          </Link>
        }
      />

      <div className="mb-3 flex items-center gap-2">
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
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">All</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
          <option value="cancelled">Cancelled</option>
          <option value="expired">Expired</option>
        </Select>
        <span className="flex-1" />
        {error && <p className="text-sm text-reject">{error}</p>}
        <p className="font-mono text-xs text-ink-soft">
          Showing {items.length} of {total}
        </p>
      </div>

      <LedgerTable
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
          { key: 'age', header: 'Age', numeric: true, render: (row) => timeAgo(row.createdAt) },
        ]}
        rows={items}
        rowKey={(row) => row.id}
        loading={loading}
        empty={
          <EmptyState
            headline="You haven't submitted anything yet"
            body="File your first request and it'll show up here so you can track its progress."
            action={
              <Link to="/submit">
                <Button variant="primary">
                  <Plus size={15} /> New request
                </Button>
              </Link>
            }
          />
        }
      />
    </>
  );
}
