/**
 * API keys (Phase 6): machine credentials with scopes. The plaintext key is
 * shown exactly once, immediately after creation — copy it or lose it.
 */
import { useCallback, useEffect, useState } from 'react';
import { LedgerTable } from '../components/LedgerTable';
import { StampChip } from '../components/StampChip';
import { Button, Card, Input, Label } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { timeAgo } from '../lib/format';

const SCOPES = [
  { value: 'evaluate', hint: 'POST /evaluate (dry runs and execution)' },
  { value: 'request:create', hint: 'POST /requests (direct workflow start)' },
  { value: 'request:read', hint: 'GET /requests and request detail' },
] as const;

interface ApiKeyRow {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export function ApiKeysPage(): React.JSX.Element {
  const [keys, setKeys] = useState<ApiKeyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<string[]>(['evaluate']);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [freshKey, setFreshKey] = useState<{ name: string; key: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      setKeys(await api<ApiKeyRow[]>('/api-keys'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const created = await api<{ name: string; key: string }>('/api-keys', {
        method: 'POST',
        body: { name, scopes },
      });
      setFreshKey({ name: created.name, key: created.key });
      setName('');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create the key. Retry.');
    } finally {
      setSaving(false);
    }
  };

  const revoke = async (id: string): Promise<void> => {
    await api(`/api-keys/${id}/revoke`, { method: 'POST' });
    await load();
  };

  return (
    <>
      {/* Section heading (§3.6) — the page-level header lives in SettingsLayout. */}
      <div className="mb-3">
        <h2 className="text-base font-semibold text-ink">API keys</h2>
        <p className="mt-0.5 text-sm text-ink-soft">
          Authenticate machine calls with{' '}
          <span className="font-mono">Authorization: Bearer ax_…</span> — scopes limit what a key
          can touch.
        </p>
      </div>

      <div className="flex flex-col gap-4">
        {freshKey && (
          <Card className="border-approve bg-approve-bg/40 p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-base font-medium text-ink">
                “{freshKey.name}” created — copy the key now, it will not be shown again.
              </p>
              <div className="flex shrink-0 gap-2">
                <Button
                  variant="primary"
                  className="h-8 text-sm"
                  onClick={() => {
                    void navigator.clipboard.writeText(freshKey.key);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  }}
                >
                  {copied ? 'Copied' : 'Copy key'}
                </Button>
                <Button variant="ghost" className="h-8 text-sm" onClick={() => setFreshKey(null)}>
                  Done
                </Button>
              </div>
            </div>
            <p className="mt-2 break-all rounded-[6px] border border-rule bg-surface px-3 py-2 font-mono text-sm text-ink">
              {freshKey.key}
            </p>
          </Card>
        )}

        <Card className="p-4">
          <p className="mb-3 text-base font-medium text-ink">Create a key</p>
          <form onSubmit={(e) => void create(e)} className="flex flex-col gap-3">
            <div>
              <Label htmlFor="key-name">Name</Label>
              <Input
                id="key-name"
                required
                placeholder="ERP integration"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div>
              <Label>Scopes</Label>
              <div className="flex flex-col gap-1.5">
                {SCOPES.map((scope) => {
                  const active = scopes.includes(scope.value);
                  return (
                    <label
                      key={scope.value}
                      className="flex cursor-pointer items-center gap-2 text-base text-ink"
                    >
                      <input
                        type="checkbox"
                        checked={active}
                        onChange={() =>
                          setScopes((prev) =>
                            active
                              ? prev.filter((entry) => entry !== scope.value)
                              : [...prev, scope.value],
                          )
                        }
                      />
                      <span className="font-mono text-sm">{scope.value}</span>
                      <span className="text-sm text-ink-soft">— {scope.hint}</span>
                    </label>
                  );
                })}
              </div>
            </div>
            {error && <p className="text-sm text-reject">{error}</p>}
            <div>
              <Button
                type="submit"
                variant="primary"
                disabled={saving || !name || scopes.length === 0}
              >
                Create key
              </Button>
            </div>
          </form>
        </Card>

        <LedgerTable<ApiKeyRow>
          columns={[
            {
              key: 'name',
              header: 'Name',
              render: (k) => <span className="font-medium">{k.name}</span>,
            },
            {
              key: 'prefix',
              header: 'Key',
              render: (k) => <span className="font-mono text-sm">{k.prefix}…</span>,
            },
            {
              key: 'scopes',
              header: 'Scopes',
              render: (k) => (
                <span className="flex flex-wrap gap-1">
                  {k.scopes.map((scope) => (
                    <span
                      key={scope}
                      className="rounded-[3px] border border-rule px-1 font-mono text-xs text-ink-soft"
                    >
                      {scope}
                    </span>
                  ))}
                </span>
              ),
            },
            {
              key: 'used',
              header: 'Last used',
              render: (k) => (
                <span className="text-sm text-ink-soft">
                  {k.lastUsedAt ? timeAgo(k.lastUsedAt) : 'never'}
                </span>
              ),
            },
            {
              key: 'status',
              header: 'Status',
              render: (k) => (
                <StampChip
                  label={k.revokedAt ? 'revoked' : 'active'}
                  tone={k.revokedAt ? 'neutral' : 'approve'}
                />
              ),
            },
            {
              key: 'actions',
              header: '',
              render: (k) =>
                k.revokedAt ? null : (
                  <Button
                    variant="danger"
                    className="h-7 text-sm"
                    onClick={() => void revoke(k.id)}
                  >
                    Revoke
                  </Button>
                ),
            },
          ]}
          rows={keys}
          rowKey={(k) => k.id}
          loading={loading}
          empty={
            <p className="text-center text-base text-ink-soft">
              No API keys yet. Create one to call ApproveX from your systems.
            </p>
          }
        />
      </div>
    </>
  );
}
