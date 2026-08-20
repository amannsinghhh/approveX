/**
 * Audit log (Phase 6 UI over the Phase 1 table, restructure §3.5): the
 * append-only ledger, edge-to-edge. Filters inline in the 48px toolbar,
 * sticky-header table in a full-height frame, pagination pinned in the
 * footer. Row click opens the before/after diff in a right-40% drawer —
 * the ledger stays pinned behind it.
 */
import { useCallback, useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { PageHeader } from '../components/AppShell';
import { KeyboardHintBar } from '../components/layout';
import { LedgerTable } from '../components/LedgerTable';
import { MonoId } from '../components/MonoId';
import { StampChip } from '../components/StampChip';
import { Button, Input, Select } from '../components/ui';
import { api } from '../lib/api';
import { formatDateTime } from '../lib/format';

interface AuditEvent {
  id: string;
  actorUserId: string | null;
  actorType: string;
  eventType: string;
  entityType: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
  ip: string | null;
  occurredAt: string;
}

const ENTITY_TYPES = [
  '',
  'tenant',
  'user',
  'roles',
  'invitations',
  'rules',
  'decision-tables',
  'workflows',
  'request',
  'request_step',
  'webhooks',
  'webhook_outbox',
  'api-keys',
  'fields',
] as const;

const PAGE_SIZE = 50;

function Actor({ event }: { event: AuditEvent }): React.JSX.Element {
  if (event.actorType === 'system') return <StampChip label="system" />;
  if (event.actorType === 'api_key') return <StampChip label="api key" tone="brand" />;
  if (event.actorUserId) return <MonoId value={event.actorUserId} />;
  return <span className="text-sm text-ink-soft">—</span>;
}

export function AuditPage(): React.JSX.Element {
  const [items, setItems] = useState<AuditEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [entity, setEntity] = useState('');
  const [entityId, setEntityId] = useState('');
  const [selected, setSelected] = useState<AuditEvent | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
      if (entity) params.set('entity', entity);
      if (entityId.trim()) params.set('entityId', entityId.trim());
      const res = await api<{ items: AuditEvent[]; total: number }>(`/audit?${params.toString()}`);
      setItems(res.items);
      setTotal(res.total);
    } finally {
      setLoading(false);
    }
  }, [page, entity, entityId]);

  useEffect(() => {
    void load();
  }, [load]);

  // §4: Esc closes the diff drawer.
  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setSelected(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected]);

  const pages = Math.max(Math.ceil(total / PAGE_SIZE), 1);

  return (
    <>
      <PageHeader title="Audit log">
        <p className="mt-1 text-sm text-ink-soft">
          Append-only — a database trigger rejects updates and deletes, even for us.
        </p>
      </PageHeader>

      <div className="flex h-[calc(100dvh-128px)] min-h-0 flex-col overflow-hidden rounded-[10px] border border-rule bg-surface elev-sm">
        {/* 48px toolbar: filters inline (§3.5). */}
        <div className="flex h-12 shrink-0 items-center gap-2 border-b border-rule px-3">
          <label
            htmlFor="audit-entity"
            className="text-xs font-medium uppercase tracking-[0.06em] text-ink-soft"
          >
            Entity
          </label>
          <Select
            id="audit-entity"
            className="h-8 w-44 text-sm"
            value={entity}
            onChange={(e) => {
              setEntity(e.target.value);
              setPage(1);
            }}
          >
            {ENTITY_TYPES.map((type) => (
              <option key={type} value={type}>
                {type === '' ? 'All entities' : type}
              </option>
            ))}
          </Select>
          <label
            htmlFor="audit-entity-id"
            className="ml-2 text-xs font-medium uppercase tracking-[0.06em] text-ink-soft"
          >
            Id
          </label>
          <Input
            id="audit-entity-id"
            placeholder="uuid…"
            className="h-8 w-72 font-mono text-sm"
            value={entityId}
            onChange={(e) => setEntityId(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') setPage(1);
            }}
          />
        </div>

        <LedgerTable
          flush
          columns={[
            {
              key: 'when',
              header: 'When',
              render: (event) => (
                <span className="whitespace-nowrap font-mono text-sm text-ink-soft">
                  {formatDateTime(event.occurredAt)}
                </span>
              ),
            },
            {
              key: 'event',
              header: 'Event',
              render: (event) => <span className="font-mono text-sm text-ink">{event.eventType}</span>,
            },
            { key: 'actor', header: 'Actor', render: (event) => <Actor event={event} /> },
            {
              key: 'entity',
              header: 'Entity',
              render: (event) => (
                <>
                  <span className="text-sm text-ink-soft">{event.entityType}</span>{' '}
                  {event.entityId && <MonoId value={event.entityId} />}
                </>
              ),
            },
            {
              key: 'ip',
              header: 'IP',
              render: (event) => (
                <span className="font-mono text-sm text-ink-soft">{event.ip ?? '—'}</span>
              ),
            },
          ]}
          rows={items}
          rowKey={(event) => event.id}
          onRowClick={(event) => setSelected(event)}
          loading={loading}
          empty={
            <p className="text-center text-base text-ink-soft">No events match these filters.</p>
          }
        />

        {/* Pagination pinned in the frame footer (§3.5). */}
        <div className="flex h-10 shrink-0 items-center gap-2 border-t border-rule px-3">
          <p className="font-mono text-xs text-ink-soft">
            {total} events · page {page}/{pages}
          </p>
          <span className="flex-1" />
          <Button
            className="h-7 px-2 text-sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            Newer
          </Button>
          <Button
            className="h-7 px-2 text-sm"
            disabled={page >= pages}
            onClick={() => setPage((p) => p + 1)}
          >
            Older
          </Button>
        </div>
      </div>

      {/* drawer (§3.5): right 40%, before/after diff. */}
      {selected && (
        <div className="fixed inset-0 z-40" role="dialog" aria-label="Audit event detail">
          <button
            type="button"
            aria-label="Close"
            className="absolute inset-0 bg-ink/10"
            onClick={() => setSelected(null)}
          />
          <div className="absolute inset-y-0 right-0 flex w-[40vw] min-w-[520px] max-w-full flex-col border-l border-rule bg-surface shadow-2xl">
            <div className="flex items-center gap-2 border-b border-rule px-3 py-1.5">
              <span className="font-mono text-sm text-ink">{selected.eventType}</span>
              <span className="flex-1" />
              <Button
                variant="ghost"
                className="h-7 px-1.5"
                aria-label="Close drawer"
                onClick={() => setSelected(null)}
              >
                <X size={15} />
              </Button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
              <dl className="grid grid-cols-[96px_1fr] gap-x-3 gap-y-1.5 text-sm">
                <dt className="text-ink-soft">When</dt>
                <dd className="font-mono">{formatDateTime(selected.occurredAt)}</dd>
                <dt className="text-ink-soft">Actor</dt>
                <dd>
                  <Actor event={selected} />
                </dd>
                <dt className="text-ink-soft">Entity</dt>
                <dd>
                  <span className="text-ink-soft">{selected.entityType}</span>{' '}
                  {selected.entityId && <MonoId value={selected.entityId} />}
                </dd>
                <dt className="text-ink-soft">IP</dt>
                <dd className="font-mono">{selected.ip ?? '—'}</dd>
              </dl>
              {selected.before !== null && (
                <div className="mt-4">
                  <p className="mb-1 text-xs font-medium uppercase tracking-wide text-ink-soft">
                    Before
                  </p>
                  <pre className="overflow-x-auto rounded-[6px] border border-rule bg-paper p-2 font-mono text-xs text-ink">
                    {JSON.stringify(selected.before, null, 2)}
                  </pre>
                </div>
              )}
              {selected.after !== null && (
                <div className="mt-4">
                  <p className="mb-1 text-xs font-medium uppercase tracking-wide text-ink-soft">
                    After
                  </p>
                  <pre className="overflow-x-auto rounded-[6px] border border-rule bg-paper p-2 font-mono text-xs text-ink">
                    {JSON.stringify(selected.after, null, 2)}
                  </pre>
                </div>
              )}
              {selected.before === null && selected.after === null && (
                <p className="mt-4 text-sm text-ink-soft">No before/after snapshot recorded.</p>
              )}
            </div>
          </div>
        </div>
      )}

      <KeyboardHintBar
        hints={[
          { keys: '↵', label: 'open diff' },
          { keys: 'Esc', label: 'close drawer' },
          { keys: '⌘K', label: 'search' },
        ]}
      />
    </>
  );
}
