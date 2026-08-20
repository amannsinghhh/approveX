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
import type { Paginated, WorkflowData } from '../lib/types';

export function WorkflowsListPage(): React.JSX.Element {
  const [workflows, setWorkflows] = useState<WorkflowData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const { can } = useAuth();

  useEffect(() => {
    api<Paginated<WorkflowData>>('/workflows?pageSize=100')
      .then((res) => setWorkflows(res.items))
      .catch(() => setError("Couldn't load workflows. Check your connection and retry."))
      .finally(() => setLoading(false));
  }, []);

  return (
    <>
      <PageHeader
        title="Workflows"
        actions={
          can('workflow:create') && (
            <Button variant="primary" onClick={() => navigate('/workflows/new')}>
              New workflow
            </Button>
          )
        }
      />
      {error && <p className="mb-4 text-base text-reject">{error}</p>}
      <LedgerTable
        columns={[
          { key: 'id', header: 'Id', render: (wf) => <MonoId value={wf.id} /> },
          {
            key: 'name',
            header: 'Name',
            render: (wf) => <span className="font-medium text-ink">{wf.name}</span>,
          },
          {
            key: 'nodes',
            header: 'Nodes',
            numeric: true,
            render: (wf) => wf.latestVersion?.graph.nodes.length ?? 0,
          },
          {
            key: 'policy',
            header: 'On reject',
            render: (wf) => (
              <span className="font-mono text-xs text-ink-soft">
                {wf.latestVersion?.rejectionPolicy === 'reject_returns_to_previous_step'
                  ? 'return to previous'
                  : 'reject request'}
              </span>
            ),
          },
          {
            key: 'version',
            header: 'Version',
            numeric: true,
            render: (wf) => (wf.currentVersion > 0 ? `v${wf.currentVersion}` : 'unpublished'),
          },
          { key: 'status', header: 'Status', render: (wf) => <StampChip label={wf.status} /> },
        ]}
        rows={workflows}
        rowKey={(wf) => wf.id}
        onRowClick={(wf) => navigate(`/workflows/${wf.id}`)}
        loading={loading}
        empty={
          <EmptyState
            headline="No workflows yet"
            body="A workflow is the approval chain a matched rule starts: who approves, in what order, with what quorum and SLA."
            action={
              can('workflow:create') && (
                <Button variant="primary" onClick={() => navigate('/workflows/new')}>
                  New workflow
                </Button>
              )
            }
          />
        }
      />
    </>
  );
}
