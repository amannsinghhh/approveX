import { useEffect, useState } from 'react';
import { PageHeader } from '../components/AppShell';
import { EmptyState } from '../components/EmptyState';
import { LedgerTable } from '../components/LedgerTable';
import { Button, Input } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import type { ManagedList } from '../lib/types';

/** Split a comma- or newline-separated textarea into clean list values. */
function parseValues(raw: string): string[] {
  return [...new Set(raw.split(/[\n,]/).map((v) => v.trim()).filter((v) => v.length > 0))];
}

export function ManagedListsPage(): React.JSX.Element {
  const [lists, setLists] = useState<ManagedList[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState({ name: '', description: '', values: '' });
  const { can } = useAuth();
  const editable = can('rule:create');

  const load = (): void => {
    api<{ items: ManagedList[] }>('/managed-lists')
      .then((res) => setLists(res.items))
      .catch(() => setError("Couldn't load managed lists. Check your connection and retry."))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const add = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    try {
      await api('/managed-lists', {
        method: 'POST',
        body: {
          name: draft.name,
          values: parseValues(draft.values),
          ...(draft.description ? { description: draft.description } : {}),
        },
      });
      setDraft({ name: '', description: '', values: '' });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create the list.');
    }
  };

  const remove = async (id: string): Promise<void> => {
    await api(`/managed-lists/${id}`, { method: 'DELETE' });
    load();
  };

  return (
    <>
      <PageHeader title="Managed lists" />
      <p className="mb-4 max-w-2xl text-base text-ink-soft">
        Named value lists power the IN_LIST and NOT_IN_LIST operators in the builder — approved
        vendors, blocked countries, exempt cost centres. Edit a list here and every rule that
        references it picks up the change on the next evaluation.
      </p>
      {editable && (
        <form onSubmit={(e) => void add(e)} className="mb-4 flex items-end gap-2">
          <div>
            <label htmlFor="lname" className="mb-1 block text-sm font-medium text-ink-soft">
              List name
            </label>
            <Input
              id="lname"
              className="w-52 font-mono text-sm"
              placeholder="approved_vendors"
              required
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </div>
          <div className="flex-1">
            <label htmlFor="lvalues" className="mb-1 block text-sm font-medium text-ink-soft">
              Values (comma or newline separated)
            </label>
            <Input
              id="lvalues"
              placeholder="acme, globex, initech"
              value={draft.values}
              onChange={(e) => setDraft({ ...draft, values: e.target.value })}
            />
          </div>
          <Button type="submit" variant="primary">
            Add list
          </Button>
        </form>
      )}
      {error && <p className="mb-3 text-base text-reject">{error}</p>}
      <LedgerTable
        columns={[
          {
            key: 'name',
            header: 'List',
            render: (list) => <span className="font-mono text-sm text-ink">{list.name}</span>,
          },
          {
            key: 'values',
            header: 'Values',
            render: (list) =>
              list.values.length === 0 ? (
                <span className="text-xs text-ink-soft">empty</span>
              ) : (
                <span className="font-mono text-xs text-ink-soft">
                  {list.values.slice(0, 6).join(', ')}
                  {list.values.length > 6 ? ` +${list.values.length - 6} more` : ''}
                </span>
              ),
          },
          {
            key: 'count',
            header: 'Count',
            className: 'w-20 text-right',
            render: (list) => (
              <span className="font-mono text-xs text-ink-soft">{list.values.length}</span>
            ),
          },
          {
            key: 'actions',
            header: '',
            className: 'w-24 text-right',
            render: (list) =>
              editable && (
                <Button
                  variant="ghost"
                  className="h-7 text-sm"
                  onClick={() => void remove(list.id)}
                >
                  Remove
                </Button>
              ),
          },
        ]}
        rows={lists}
        rowKey={(list) => list.id}
        loading={loading}
        empty={
          <EmptyState
            headline="No managed lists yet"
            body="Create a named value list — approved_vendors, blocked_countries — so builders can check membership with IN_LIST instead of hand-listing values on every rule."
          />
        }
      />
    </>
  );
}
