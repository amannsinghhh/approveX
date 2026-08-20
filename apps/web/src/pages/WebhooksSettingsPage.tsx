/**
 * Webhooks settings (Phase 6): endpoint registry, per-tenant signing secret,
 * and the delivery log — event, stamp, attempts, response code, next retry.
 */
import { useCallback, useEffect, useState } from 'react';
import { LedgerTable } from '../components/LedgerTable';
import { MonoId } from '../components/MonoId';
import { StampChip, type StampTone } from '../components/StampChip';
import { Button, Card, Input, Label } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { formatDateTime, timeAgo } from '../lib/format';

const EVENT_TYPES = [
  'request.created',
  'request.approved',
  'request.rejected',
  'request.cancelled',
  'step.escalated',
  'workflow.webhook_call',
  'ping',
] as const;

interface Endpoint {
  id: string;
  url: string;
  description: string | null;
  events: string[];
  enabled: boolean;
  createdAt: string;
}

interface Delivery {
  id: string;
  eventType: string;
  status: 'pending' | 'delivering' | 'delivered' | 'dead_letter';
  attempts: number;
  lastStatusCode: number | null;
  lastError: string | null;
  nextAttemptAt: string;
  deliveredAt: string | null;
  createdAt: string;
}

const DELIVERY_TONE: Record<Delivery['status'], StampTone> = {
  delivered: 'approve',
  pending: 'pending',
  delivering: 'pending',
  dead_letter: 'reject',
};

function SecretCard(): React.JSX.Element {
  const [secret, setSecret] = useState<string | null>(null);
  const [confirmRotate, setConfirmRotate] = useState(false);
  const [copied, setCopied] = useState(false);

  const reveal = async (): Promise<void> =>
    setSecret((await api<{ secret: string }>('/webhooks/secret')).secret);
  const rotate = async (): Promise<void> => {
    setSecret(
      (await api<{ secret: string }>('/webhooks/secret/rotate', { method: 'POST' })).secret,
    );
    setConfirmRotate(false);
  };

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-base font-medium text-ink">Signing secret</p>
          <p className="mt-0.5 text-sm text-ink-soft">
            Every delivery is signed HMAC-SHA256 in{' '}
            <span className="font-mono">X-ApproveX-Signature</span>. Verify it before trusting a
            payload.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {secret === null ? (
            <Button onClick={() => void reveal()}>Reveal secret</Button>
          ) : (
            <>
              <Button
                variant="ghost"
                onClick={() => {
                  void navigator.clipboard.writeText(secret);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
              >
                {copied ? 'Copied' : 'Copy'}
              </Button>
              {confirmRotate ? (
                <>
                  <Button variant="danger" onClick={() => void rotate()}>
                    Yes, rotate now
                  </Button>
                  <Button variant="ghost" onClick={() => setConfirmRotate(false)}>
                    Cancel
                  </Button>
                </>
              ) : (
                <Button variant="danger" onClick={() => setConfirmRotate(true)}>
                  Rotate
                </Button>
              )}
            </>
          )}
        </div>
      </div>
      {secret !== null && (
        <p className="mt-3 break-all rounded-[6px] border border-rule bg-paper px-3 py-2 font-mono text-sm text-ink">
          {secret}
        </p>
      )}
      {confirmRotate && (
        <p className="mt-2 text-sm text-reject">
          Rotating invalidates the current secret immediately — update your receivers first.
        </p>
      )}
    </Card>
  );
}

function DeliveryLog({ endpointId }: { endpointId: string }): React.JSX.Element {
  const [deliveries, setDeliveries] = useState<Delivery[] | null>(null);

  const load = useCallback(async () => {
    const res = await api<{ items: Delivery[] }>(`/webhooks/${endpointId}/deliveries`);
    setDeliveries(res.items);
  }, [endpointId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="mt-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-sm font-medium text-ink-soft">Recent deliveries</p>
        <Button variant="ghost" className="h-7 text-sm" onClick={() => void load()}>
          Refresh
        </Button>
      </div>
      <LedgerTable<Delivery>
        columns={[
          {
            key: 'event',
            header: 'Event',
            render: (d) => <span className="font-mono text-sm">{d.eventType}</span>,
          },
          {
            key: 'status',
            header: 'Status',
            render: (d) => (
              <StampChip label={d.status.replace('_', ' ')} tone={DELIVERY_TONE[d.status]} />
            ),
          },
          { key: 'attempts', header: 'Attempts', numeric: true, render: (d) => d.attempts },
          {
            key: 'code',
            header: 'Last code',
            numeric: true,
            render: (d) => d.lastStatusCode ?? '—',
          },
          {
            key: 'when',
            header: 'Delivered / next retry',
            render: (d) =>
              d.status === 'delivered' && d.deliveredAt ? (
                <span className="font-mono text-sm">{formatDateTime(d.deliveredAt)}</span>
              ) : d.status === 'pending' ? (
                <span className="font-mono text-sm">{formatDateTime(d.nextAttemptAt)}</span>
              ) : (
                <span
                  className="max-w-[280px] truncate font-mono text-xs text-ink-soft"
                  title={d.lastError ?? ''}
                >
                  {d.lastError ?? '—'}
                </span>
              ),
          },
          {
            key: 'age',
            header: 'Enqueued',
            render: (d) => <span className="text-sm text-ink-soft">{timeAgo(d.createdAt)}</span>,
          },
        ]}
        rows={deliveries ?? []}
        rowKey={(d) => d.id}
        loading={deliveries === null}
        empty={
          <p className="text-center text-base text-ink-soft">
            No deliveries yet. Send a test event to see the log fill in.
          </p>
        }
      />
    </div>
  );
}

export function WebhooksSettingsPage(): React.JSX.Element {
  const [endpoints, setEndpoints] = useState<Endpoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pinged, setPinged] = useState<string | null>(null);

  // add form
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setEndpoints(await api<Endpoint[]>('/webhooks'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const add = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api('/webhooks', { method: 'POST', body: { url, events } });
      setUrl('');
      setEvents([]);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not add the endpoint. Retry.');
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (endpoint: Endpoint): Promise<void> => {
    await api(`/webhooks/${endpoint.id}`, {
      method: 'PATCH',
      body: { enabled: !endpoint.enabled },
    });
    await load();
  };

  const remove = async (endpoint: Endpoint): Promise<void> => {
    await api(`/webhooks/${endpoint.id}`, { method: 'DELETE' });
    if (expanded === endpoint.id) setExpanded(null);
    await load();
  };

  const ping = async (endpoint: Endpoint): Promise<void> => {
    await api(`/webhooks/${endpoint.id}/ping`, { method: 'POST' });
    setPinged(endpoint.id);
    setTimeout(() => setPinged(null), 2000);
    setExpanded(endpoint.id);
  };

  return (
    <>
      {/* Section heading (§3.6) — the page-level header lives in SettingsLayout. */}
      <div className="mb-3">
        <h2 className="text-base font-semibold text-ink">Webhooks</h2>
        <p className="mt-0.5 text-sm text-ink-soft">
          Signed events, delivered with retries (1m · 5m · 30m · 2h · 12h) and dead-lettered after
          that.
        </p>
      </div>

      <div className="flex flex-col gap-4">
        <SecretCard />

        <Card className="p-4">
          <p className="mb-3 text-base font-medium text-ink">Add an endpoint</p>
          <form onSubmit={(e) => void add(e)} className="flex flex-col gap-3">
            <div>
              <Label htmlFor="wh-url">URL</Label>
              <Input
                id="wh-url"
                type="url"
                required
                placeholder="https://erp.example.com/approvex-hook"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                className="font-mono text-sm"
              />
            </div>
            <div>
              <Label>Events (none selected = everything)</Label>
              <div className="flex flex-wrap gap-1.5">
                {EVENT_TYPES.map((event) => {
                  const active = events.includes(event);
                  return (
                    <button
                      key={event}
                      type="button"
                      onClick={() =>
                        setEvents((prev) =>
                          active ? prev.filter((entry) => entry !== event) : [...prev, event],
                        )
                      }
                      className={
                        'rounded-[4px] border px-2 py-0.5 font-mono text-xs transition-colors duration-120 ' +
                        (active
                          ? 'border-brand bg-brand-bg text-brand'
                          : 'border-rule text-ink-soft hover:border-ink-soft')
                      }
                    >
                      {event}
                    </button>
                  );
                })}
              </div>
            </div>
            {error && <p className="text-sm text-reject">{error}</p>}
            <div>
              <Button type="submit" variant="primary" disabled={saving || !url}>
                Add endpoint
              </Button>
            </div>
          </form>
        </Card>

        {loading && <div className="h-24 animate-pulse rounded-[10px] bg-rule/40" />}
        {!loading && endpoints.length === 0 && (
          <Card className="flex flex-col items-center gap-2 py-10">
            <StampChip label="NO ENDPOINTS" />
            <p className="text-base text-ink-soft">
              Add an endpoint above — ApproveX will call it whenever a decision lands.
            </p>
          </Card>
        )}
        {endpoints.map((endpoint) => (
          <Card key={endpoint.id} className="p-4">
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="truncate font-mono text-sm text-ink">{endpoint.url}</p>
                <p className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-ink-soft">
                  <MonoId value={endpoint.id} />
                  <span>·</span>
                  {endpoint.events.length === 0 ? (
                    <span>all events</span>
                  ) : (
                    endpoint.events.map((event) => (
                      <span key={event} className="rounded-[3px] border border-rule px-1 font-mono">
                        {event}
                      </span>
                    ))
                  )}
                </p>
              </div>
              <StampChip
                label={endpoint.enabled ? 'enabled' : 'disabled'}
                tone={endpoint.enabled ? 'approve' : 'neutral'}
              />
              <Button className="h-8 text-sm" onClick={() => void ping(endpoint)}>
                {pinged === endpoint.id ? 'Ping sent' : 'Send test'}
              </Button>
              <Button className="h-8 text-sm" onClick={() => void toggle(endpoint)}>
                {endpoint.enabled ? 'Disable' : 'Enable'}
              </Button>
              <Button
                className="h-8 text-sm"
                onClick={() => setExpanded((prev) => (prev === endpoint.id ? null : endpoint.id))}
              >
                {expanded === endpoint.id ? 'Hide log' : 'Deliveries'}
              </Button>
              <Button
                variant="danger"
                className="h-8 text-sm"
                onClick={() => void remove(endpoint)}
              >
                Delete
              </Button>
            </div>
            {expanded === endpoint.id && <DeliveryLog endpointId={endpoint.id} />}
          </Card>
        ))}
      </div>
    </>
  );
}
