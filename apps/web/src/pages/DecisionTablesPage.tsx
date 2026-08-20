import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '../components/AppShell';
import { EmptyState } from '../components/EmptyState';
import { LedgerTable } from '../components/LedgerTable';
import { MonoId } from '../components/MonoId';
import { StampChip } from '../components/StampChip';
import { Button } from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import type { DecisionTable, Paginated } from '../lib/types';

export function DecisionTablesPage(): React.JSX.Element {
  const [tables, setTables] = useState<DecisionTable[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const { can } = useAuth();

  useEffect(() => {
    api<Paginated<DecisionTable>>('/decision-tables?pageSize=100')
      .then((res) => setTables(res.items))
      .catch(() => setError("Couldn't load decision tables. Check your connection and retry."))
      .finally(() => setLoading(false));
  }, []);

  return (
    <>
      <PageHeader
        title="Decision tables"
        actions={
          can('rule:create') && (
            <Button variant="primary" onClick={() => navigate('/decision-tables/new')}>
              New decision table
            </Button>
          )
        }
      />
      {error && <p className="mb-4 text-base text-reject">{error}</p>}
      <LedgerTable
        columns={[
          { key: 'id', header: 'Id', render: (t) => <MonoId value={t.id} /> },
          {
            key: 'name',
            header: 'Name',
            render: (t) => <span className="font-medium text-ink">{t.name}</span>,
          },
          {
            key: 'context',
            header: 'Context',
            render: (t) => <span className="font-mono text-sm">{t.context}</span>,
          },
          {
            key: 'rows',
            header: 'Rows',
            numeric: true,
            render: (t) => t.latestVersion?.rows.length ?? 0,
          },
          {
            key: 'hitPolicy',
            header: 'Hit policy',
            render: (t) => (
              <span className="font-mono text-xs text-ink-soft">
                {t.latestVersion?.hitPolicy ?? '—'}
              </span>
            ),
          },
          { key: 'status', header: 'Status', render: (t) => <StampChip label={t.status} /> },
        ]}
        rows={tables}
        rowKey={(t) => t.id}
        onRowClick={(t) => navigate(`/decision-tables/${t.id}`)}
        loading={loading}
        empty={
          <EmptyState
            headline="No decision tables yet"
            body="Finance teams think in tables: each row pairs conditions (amount ranges, departments) with the workflow to run. Rows compile to the same engine as rules."
            action={
              can('rule:create') && (
                <Button variant="primary" onClick={() => navigate('/decision-tables/new')}>
                  New decision table
                </Button>
              )
            }
          />
        }
      />
    </>
  );
}
