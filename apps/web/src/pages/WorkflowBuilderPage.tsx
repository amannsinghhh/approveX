/**
 * Workflow Builder (UI spec §5.3, restructure §3.4): the canvas IS the page —
 * it bleeds edge to edge and the dot grid runs under every panel. The palette
 * floats top-left, the config panel slides in from the right on selection, and
 * validation issues dock along the bottom only when there are errors.
 * Nodes are 220px cards color-coded by a 3px top border; the version bar shows
 * history with restore-as-draft.
 */
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { Connection, Edge, Node, NodeProps } from '@xyflow/react';
import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { ConditionNode } from '../../../../shared/src/index';
import { PageHeader } from '../components/AppShell';
import { ConditionGroup, emptyGroup } from '../components/condition-builder';
import { FieldHelp } from '../components/FieldHelp';
import { StampChip } from '../components/StampChip';
import { Button, Input, Label, Segmented, Select } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { cn } from '../lib/cn';
import { useAuth } from '../lib/auth';
import type {
  FieldDefinition,
  ManagedList,
  WorkflowData,
  WorkflowGraphEdge,
  WorkflowGraphNode,
} from '../lib/types';

interface RoleOption {
  id: string;
  name: string;
  memberCount?: number;
}

/** A.1 #3 — one quiet sentence saying what this quorum choice means in practice. */
function quorumConsequence(node: WorkflowGraphNode, roles: RoleOption[]): string {
  const role = roles.find((candidate) => candidate.id === node.config?.roleId);
  const members = role?.memberCount;
  const group =
    role && members !== undefined
      ? `${role.name} (${members} member${members === 1 ? '' : 's'})`
      : (role?.name ?? 'the selected role');
  const quorum = node.config?.quorum ?? 'all';
  if (quorum === 'any') {
    return `The first approval from ${group} completes this step — nobody else is asked.`;
  }
  if (typeof quorum === 'object') {
    const needed = quorum.n;
    if (members !== undefined && needed > members) {
      return `Needs ${needed} approvals but ${group} only has ${members} — this step can never complete. Lower N or add members.`;
    }
    return `Approves after ${needed} of ${group} sign off; remaining approvers are skipped.`;
  }
  return `Every member of ${group} must approve — one person on leave stalls this step.`;
}

const NODE_ACCENT: Record<string, string> = {
  start: 'var(--ink-soft)',
  approval: 'var(--brand)',
  parallel: 'var(--ink-soft)',
  auto_approve: 'var(--stamp-approve)',
  auto_reject: 'var(--stamp-reject)',
  webhook_call: '#6D28D9',
  wait: 'var(--stamp-pending)',
  condition_branch: 'var(--stamp-pending)',
};

const PALETTE: { type: string; label: string }[] = [
  { type: 'approval', label: 'Approval' },
  { type: 'parallel', label: 'Parallel fork' },
  { type: 'condition_branch', label: 'Condition branch' },
  { type: 'auto_approve', label: 'Auto approve' },
  { type: 'auto_reject', label: 'Auto reject' },
  { type: 'webhook_call', label: 'Webhook (Phase 6)' },
  { type: 'wait', label: 'Wait (Phase 6)' },
];

type FlowNodeData = { node: WorkflowGraphNode; roles: RoleOption[]; invalid: boolean };

function quorumSummary(config: WorkflowGraphNode['config']): string {
  const quorum = config?.quorum ?? 'all';
  if (quorum === 'all') return 'All members';
  if (quorum === 'any') return 'Any 1';
  return `${(quorum as { n: number }).n} of role`;
}

function FlowNode({ data, selected }: NodeProps): React.JSX.Element {
  const { node, roles, invalid } = data as FlowNodeData;
  const role = roles.find((candidate) => candidate.id === node.config?.roleId);
  const summary =
    node.type === 'approval'
      ? `${quorumSummary(node.config)} of ${role?.name ?? '—'}${
          node.config?.slaHours ? ` · ${node.config.slaHours}h SLA` : ''
        }`
      : node.type === 'condition_branch'
        ? 'routes by edge conditions'
        : node.type === 'wait' || node.type === 'webhook_call'
          ? 'executes from Phase 6'
          : '';

  return (
    <div
      className={cn(
        'w-[220px] rounded-[10px] border bg-surface px-3 py-2',
        invalid ? 'border-reject shadow-[0_0_0_1px_var(--stamp-reject)]' : 'border-rule',
        selected && !invalid && 'shadow-[0_0_0_1px_var(--brand)] border-brand',
      )}
      style={{ borderTopWidth: 3, borderTopColor: NODE_ACCENT[node.type] ?? 'var(--rule)' }}
    >
      {node.type !== 'start' && <Handle type="target" position={Position.Left} />}
      <p className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-ink-soft">
        {node.type.replace(/_/g, ' ')}
      </p>
      <p className="truncate text-base font-medium text-ink">
        {node.label ?? (node.type === 'approval' ? (role?.name ?? node.id) : node.id)}
      </p>
      {summary && <p className="truncate text-xs text-ink-soft">{summary}</p>}
      {node.type !== 'auto_approve' && node.type !== 'auto_reject' && (
        <Handle type="source" position={Position.Right} />
      )}
    </div>
  );
}

const nodeTypes = { approvex: FlowNode };

/** Column layout for graphs that arrived without stored positions. */
function autoLayout(
  nodes: WorkflowGraphNode[],
  edges: WorkflowGraphEdge[],
): Map<string, { x: number; y: number }> {
  const depth = new Map<string, number>();
  const start = nodes.find((node) => node.type === 'start');
  if (start) {
    depth.set(start.id, 0);
    const queue = [start.id];
    while (queue.length > 0) {
      const id = queue.shift() as string;
      for (const edge of edges.filter((candidate) => candidate.from === id)) {
        const next = (depth.get(id) ?? 0) + 1;
        if ((depth.get(edge.to) ?? -1) < next) {
          depth.set(edge.to, next);
          queue.push(edge.to);
        }
      }
    }
  }
  const perColumn = new Map<number, number>();
  const positions = new Map<string, { x: number; y: number }>();
  for (const node of nodes) {
    const column = depth.get(node.id) ?? 0;
    const row = perColumn.get(column) ?? 0;
    perColumn.set(column, row + 1);
    positions.set(node.id, { x: 40 + column * 280, y: 60 + row * 130 });
  }
  return positions;
}

export function WorkflowBuilderPage(): React.JSX.Element {
  const { id } = useParams();
  const isNew = id === undefined;
  const navigate = useNavigate();
  const { can } = useAuth();

  const [workflow, setWorkflow] = useState<WorkflowData | null>(null);
  const [name, setName] = useState('');
  const [rejectionPolicy, setRejectionPolicy] = useState<
    'any_reject_kills' | 'reject_returns_to_previous_step'
  >('any_reject_kills');
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [fields, setFields] = useState<FieldDefinition[]>([]);
  const [listNames, setListNames] = useState<string[]>([]);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [issues, setIssues] = useState<{ path: string; message: string }[]>([]);
  const [message, setMessage] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [viewingVersion, setViewingVersion] = useState<number | null>(null);

  const readOnly = viewingVersion !== null;

  const toFlow = useCallback(
    (graph: { nodes: WorkflowGraphNode[]; edges: WorkflowGraphEdge[] }, roleList: RoleOption[]) => {
      const layout = autoLayout(graph.nodes, graph.edges);
      setNodes(
        graph.nodes.map((node) => ({
          id: node.id,
          type: 'approvex',
          position: node.position ?? layout.get(node.id) ?? { x: 40, y: 60 },
          data: { node, roles: roleList, invalid: false },
        })),
      );
      setEdges(
        graph.edges.map((edge) => ({
          id: `${edge.from}->${edge.to}`,
          source: edge.from,
          target: edge.to,
          label: edge.condition ? 'if…' : edge.isDefault ? 'default' : undefined,
          data: { condition: edge.condition, isDefault: edge.isDefault },
        })),
      );
    },
    [],
  );

  useEffect(() => {
    void (async () => {
      const rolesRes = await api<{ items: RoleOption[] }>('/roles');
      setRoles(rolesRes.items);
      void api<{ items: FieldDefinition[] }>('/fields').then((res) => setFields(res.items));
      void api<{ items: ManagedList[] }>('/managed-lists').then((res) =>
        setListNames(res.items.map((list) => list.name)),
      );
      if (!isNew && id) {
        const loaded = await api<WorkflowData>(`/workflows/${id}`);
        setWorkflow(loaded);
        setName(loaded.name);
        const head = loaded.versions?.[0] ?? loaded.latestVersion;
        if (head) {
          setRejectionPolicy(head.rejectionPolicy);
          toFlow(head.graph, rolesRes.items);
        }
      } else {
        toFlow(
          {
            nodes: [{ id: 'start', type: 'start' }],
            edges: [],
          },
          rolesRes.items,
        );
      }
    })();
  }, [id, isNew, toFlow]);

  /** Canonical graph JSON derived from the canvas. */
  const buildGraph = useCallback(() => {
    return {
      nodes: nodes.map((flowNode) => {
        const { node } = flowNode.data as FlowNodeData;
        return { ...node, position: flowNode.position };
      }),
      edges: edges.map((edge) => {
        const data = (edge.data ?? {}) as { condition?: unknown; isDefault?: boolean };
        return {
          from: edge.source,
          to: edge.target,
          ...(data.condition !== undefined ? { condition: data.condition } : {}),
          ...(data.isDefault ? { isDefault: true } : {}),
        };
      }),
    };
  }, [nodes, edges]);

  const patchNode = (nodeId: string, patch: Partial<WorkflowGraphNode>): void => {
    setNodes((prev) =>
      prev.map((flowNode) => {
        if (flowNode.id !== nodeId) return flowNode;
        const data = flowNode.data as FlowNodeData;
        return {
          ...flowNode,
          data: {
            ...data,
            node: { ...data.node, ...patch, config: { ...data.node.config, ...patch.config } },
          },
        };
      }),
    );
  };

  const addNode = (type: string): void => {
    const existing = new Set(nodes.map((flowNode) => flowNode.id));
    let index = 1;
    while (existing.has(`${type}_${index}`)) index += 1;
    const nodeId = `${type}_${index}`;
    const node: WorkflowGraphNode = {
      id: nodeId,
      type,
      ...(type === 'approval' ? { config: { roleId: roles[0]?.id, quorum: 'any' as const } } : {}),
    };
    setNodes((prev) => [
      ...prev,
      {
        id: nodeId,
        type: 'approvex',
        position: { x: 120 + prev.length * 40, y: 80 + prev.length * 40 },
        data: { node, roles, invalid: false },
      },
    ]);
    setSelectedNodeId(nodeId);
  };

  const validate = async (): Promise<boolean> => {
    const res = await api<{ valid: boolean; issues: { path: string; message: string }[] }>(
      '/workflows/validate',
      { method: 'POST', body: { graph: buildGraph(), rejectionPolicy } },
    );
    setIssues(res.issues);
    const flagged = new Set<string>();
    for (const issue of res.issues) {
      for (const flowNode of nodes) {
        if (issue.message.includes(`"${flowNode.id}"`) || issue.path.includes(`(${flowNode.id})`)) {
          flagged.add(flowNode.id);
        }
      }
    }
    setNodes((prev) =>
      prev.map((flowNode) => ({
        ...flowNode,
        data: { ...(flowNode.data as FlowNodeData), invalid: flagged.has(flowNode.id) },
      })),
    );
    return res.valid;
  };

  const save = async (): Promise<string | null> => {
    setBusy(true);
    setMessage(null);
    try {
      const body = { graph: buildGraph(), rejectionPolicy };
      if (isNew) {
        const created = await api<WorkflowData>('/workflows', {
          method: 'POST',
          body: { name, ...body },
        });
        setMessage({ tone: 'ok', text: 'Draft saved' });
        navigate(`/workflows/${created.id}`, { replace: true });
        return created.id;
      }
      if (workflow && name !== workflow.name) {
        await api(`/workflows/${id}`, { method: 'PATCH', body: { name } });
      }
      await api(`/workflows/${id}/draft`, { method: 'PUT', body });
      setMessage({ tone: 'ok', text: 'Draft saved' });
      return id ?? null;
    } catch (err) {
      if (err instanceof ApiError && Array.isArray((err.body as { issues?: unknown }).issues)) {
        setIssues((err.body as { issues: { path: string; message: string }[] }).issues);
      }
      setMessage({ tone: 'err', text: err instanceof ApiError ? err.message : 'Could not save.' });
      return null;
    } finally {
      setBusy(false);
    }
  };

  const publish = async (): Promise<void> => {
    if (!(await validate())) {
      setMessage({ tone: 'err', text: 'Fix the validation errors before publishing.' });
      return;
    }
    const workflowId = await save();
    if (!workflowId) return;
    setBusy(true);
    try {
      const published = await api<{ version: number }>(`/workflows/${workflowId}/publish`, {
        method: 'POST',
      });
      setMessage({ tone: 'ok', text: `Workflow published — v${published.version}` });
      setWorkflow(await api<WorkflowData>(`/workflows/${workflowId}`));
    } catch (err) {
      setMessage({
        tone: 'err',
        text: err instanceof ApiError ? err.message : 'Could not publish.',
      });
    } finally {
      setBusy(false);
    }
  };

  const viewVersion = (version: number | null): void => {
    setViewingVersion(version);
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
    const source =
      version === null
        ? (workflow?.versions?.[0] ?? workflow?.latestVersion)
        : workflow?.versions?.find((candidate) => candidate.version === version);
    if (source) {
      setRejectionPolicy(source.rejectionPolicy);
      toFlow(source.graph, roles);
    }
  };

  const selectedNode = nodes.find((flowNode) => flowNode.id === selectedNodeId);
  const selectedNodeData = selectedNode ? (selectedNode.data as FlowNodeData).node : null;
  const selectedEdge = edges.find((edge) => edge.id === selectedEdgeId);

  return (
    <div className="flex h-[calc(100dvh-12px)] flex-col">
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            <Input
              aria-label="Workflow name"
              className="h-10 w-80 text-lg font-bold"
              placeholder="Manager → Finance → CFO"
              value={name}
              disabled={readOnly}
              onChange={(e) => setName(e.target.value)}
            />
            <StampChip label={workflow?.status ?? 'draft'} />
            {readOnly && <StampChip label={`viewing v${viewingVersion}`} tone="pending" />}
          </span>
        }
        actions={
          readOnly ? (
            <>
              <Button onClick={() => viewVersion(null)}>Back to draft</Button>
              {can('workflow:create') && (
                <Button
                  variant="primary"
                  onClick={() => {
                    setViewingVersion(null);
                    setMessage({
                      tone: 'ok',
                      text: `v${viewingVersion} loaded as the working draft — save to keep it`,
                    });
                  }}
                >
                  Restore as new draft
                </Button>
              )}
            </>
          ) : (
            <>
              <Button
                onClick={() =>
                  void validate().then((valid) => {
                    setMessage(valid ? { tone: 'ok', text: 'Graph is valid.' } : null);
                  })
                }
              >
                Validate
              </Button>
              {can('workflow:create') && (
                <Button onClick={() => void save()} disabled={busy || !name}>
                  Save draft
                </Button>
              )}
              {can('workflow:publish') && (
                <Button variant="primary" onClick={() => void publish()} disabled={busy || !name}>
                  Publish workflow
                </Button>
              )}
            </>
          )
        }
      >
        <div className="mt-2 flex items-center gap-4">
          <Segmented
            value={rejectionPolicy}
            options={[
              { value: 'any_reject_kills' as const, label: 'Reject kills request' },
              {
                value: 'reject_returns_to_previous_step' as const,
                label: 'Reject returns to previous',
              },
            ]}
            onChange={(value) => !readOnly && setRejectionPolicy(value)}
          />
          {(workflow?.versions?.length ?? 0) > 0 && (
            <span className="flex items-center gap-1 font-mono text-sm text-ink-soft">
              {workflow?.versions?.map((version) => (
                <button
                  key={version.id}
                  type="button"
                  onClick={() => viewVersion(version.version)}
                  className={cn(
                    'rounded px-1.5 py-0.5 hover:text-ink',
                    viewingVersion === version.version && 'bg-brand-bg text-brand',
                  )}
                >
                  v{version.version}
                  {version.version === workflow.currentVersion && ' ✓'}
                </button>
              ))}
            </span>
          )}
          {message && (
            <span className={cn('text-sm', message.tone === 'ok' ? 'text-approve' : 'text-reject')}>
              {message.text}
            </span>
          )}
        </div>
      </PageHeader>

      <div className="relative -mx-4 -mb-3 mt-2 min-h-0 flex-1 overflow-hidden border-t border-rule">
        {/* §3.4 — the canvas is the page: the dot grid bleeds edge to edge, under the panels */}
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={(changes) =>
            !readOnly &&
            setNodes(
              (prev) =>
                applyNodeChanges(
                  changes.filter((change) => !(change.type === 'remove' && change.id === 'start')),
                  prev,
                ) as Node[],
            )
          }
          onEdgesChange={(changes) =>
            !readOnly && setEdges((prev) => applyEdgeChanges(changes, prev))
          }
          onConnect={(connection: Connection) =>
            !readOnly &&
            setEdges((prev) =>
              addEdge({ ...connection, id: `${connection.source}->${connection.target}` }, prev),
            )
          }
          onNodeClick={(_event, flowNode) => {
            setSelectedNodeId(flowNode.id);
            setSelectedEdgeId(null);
          }}
          onEdgeClick={(_event, edge) => {
            setSelectedEdgeId(edge.id);
            setSelectedNodeId(null);
          }}
          onPaneClick={() => {
            setSelectedNodeId(null);
            setSelectedEdgeId(null);
          }}
          fitView
          proOptions={{ hideAttribution: true }}
          style={{ background: 'var(--paper)' }}
        >
          <Background gap={16} size={1} color="var(--rule)" />
          <Controls showInteractive={false} />
        </ReactFlow>

        {/* palette — floats top-left over the grid */}
        {!readOnly && (
          <div className="absolute left-4 top-4 z-10 flex w-44 flex-col gap-1 rounded-[10px] border border-rule bg-surface/90 p-2 backdrop-blur-md elev-md">
            <p className="px-1 pb-1 text-xs font-medium uppercase tracking-wide text-ink-soft">
              Add node
            </p>
            {PALETTE.map((item) => (
              <Button
                key={item.type}
                variant="ghost"
                className="h-8 justify-start text-sm"
                onClick={() => addNode(item.type)}
              >
                <span
                  className="mr-1 inline-block h-2.5 w-2.5 rounded-sm"
                  style={{ background: NODE_ACCENT[item.type] }}
                />
                {item.label}
              </Button>
            ))}
            <p className="mt-2 px-1 text-xs leading-4 text-ink-soft">
              Drag between node handles to connect. Select + Backspace deletes.
            </p>
          </div>
        )}

        {/* config panel — slides in from the right on selection */}
        {!readOnly && (selectedNodeData || selectedEdge) && (
          <div
            key={selectedNodeId ?? selectedEdgeId ?? 'config'}
            className={cn(
              'animate-pane-in absolute bottom-4 right-4 top-4 z-10 flex flex-col gap-3 overflow-y-auto rounded-[10px] border border-rule bg-surface/95 p-3 backdrop-blur-md elev-md',
              selectedEdge ? 'w-[400px]' : 'w-72',
            )}
          >
            {selectedNodeData && !readOnly && (
              <>
                <p className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-ink-soft">
                  {selectedNodeData.type.replace(/_/g, ' ')} · {selectedNodeData.id}
                </p>
                <div>
                  <Label htmlFor="n-label">Label</Label>
                  <Input
                    id="n-label"
                    value={selectedNodeData.label ?? ''}
                    onChange={(e) => patchNode(selectedNodeData.id, { label: e.target.value })}
                  />
                </div>
                {selectedNodeData.type === 'approval' && (
                  <>
                    <div>
                      <Label htmlFor="n-role">Role</Label>
                      <Select
                        id="n-role"
                        className="w-full"
                        value={selectedNodeData.config?.roleId ?? ''}
                        onChange={(e) =>
                          patchNode(selectedNodeData.id, { config: { roleId: e.target.value } })
                        }
                      >
                        {roles.map((role) => (
                          <option key={role.id} value={role.id}>
                            {role.name}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <div>
                      <Label>Quorum</Label>
                      <Segmented
                        value={
                          typeof selectedNodeData.config?.quorum === 'object'
                            ? 'n'
                            : ((selectedNodeData.config?.quorum ?? 'all') as string)
                        }
                        options={[
                          { value: 'all', label: 'All' },
                          { value: 'any', label: 'Any' },
                          { value: 'n', label: 'N of M' },
                        ]}
                        onChange={(value) =>
                          patchNode(selectedNodeData.id, {
                            config: { quorum: value === 'n' ? { n: 2 } : (value as 'all' | 'any') },
                          })
                        }
                      />
                      {typeof selectedNodeData.config?.quorum === 'object' && (
                        <Input
                          type="number"
                          min={1}
                          aria-label="Approvals needed"
                          className="mt-1.5 w-24 font-mono text-sm"
                          value={(selectedNodeData.config.quorum as { n: number }).n}
                          onChange={(e) =>
                            patchNode(selectedNodeData.id, {
                              config: { quorum: { n: Number(e.target.value) || 1 } },
                            })
                          }
                        />
                      )}
                      <FieldHelp>{quorumConsequence(selectedNodeData, roles)}</FieldHelp>
                    </div>
                    <div>
                      <Label htmlFor="n-sla">SLA hours</Label>
                      <Input
                        id="n-sla"
                        type="number"
                        min={0}
                        className="w-24 font-mono text-sm"
                        value={selectedNodeData.config?.slaHours ?? ''}
                        onChange={(e) =>
                          patchNode(selectedNodeData.id, {
                            config: {
                              slaHours: e.target.value ? Number(e.target.value) : undefined,
                            },
                          })
                        }
                      />
                    </div>
                    <div>
                      <Label htmlFor="n-esc">Escalate to</Label>
                      <Select
                        id="n-esc"
                        className="w-full"
                        value={selectedNodeData.config?.escalateToRoleId ?? ''}
                        onChange={(e) =>
                          patchNode(selectedNodeData.id, {
                            config: { escalateToRoleId: e.target.value || null },
                          })
                        }
                      >
                        <option value="">No escalation</option>
                        {roles.map((role) => (
                          <option key={role.id} value={role.id}>
                            {role.name}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <label className="flex items-center gap-2 text-sm text-ink">
                      <input
                        type="checkbox"
                        checked={selectedNodeData.config?.allowDelegation !== false}
                        onChange={(e) =>
                          patchNode(selectedNodeData.id, {
                            config: { allowDelegation: e.target.checked },
                          })
                        }
                      />
                      Allow delegation
                    </label>
                  </>
                )}
              </>
            )}

            {selectedEdge && !readOnly && (
              <>
                <p className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-ink-soft">
                  edge · {selectedEdge.id}
                </p>
                <label className="flex items-center gap-2 text-sm text-ink">
                  <input
                    type="checkbox"
                    checked={Boolean((selectedEdge.data as { isDefault?: boolean })?.isDefault)}
                    onChange={(e) =>
                      setEdges((prev) =>
                        prev.map((edge) =>
                          edge.id === selectedEdge.id
                            ? {
                                ...edge,
                                label: e.target.checked ? 'default' : undefined,
                                data: {
                                  ...edge.data,
                                  isDefault: e.target.checked,
                                  condition: undefined,
                                },
                              }
                            : edge,
                        ),
                      )
                    }
                  />
                  Default branch
                </label>
                {(() => {
                  const edgeData = (selectedEdge.data ?? {}) as {
                    condition?: ConditionNode;
                    isDefault?: boolean;
                  };
                  const sourceNode = nodes.find(
                    (flowNode) => flowNode.id === selectedEdge.source,
                  );
                  const sourceType = sourceNode
                    ? (sourceNode.data as FlowNodeData).node.type
                    : undefined;
                  const setCondition = (condition: ConditionNode | undefined): void =>
                    setEdges((prev) =>
                      prev.map((edge) =>
                        edge.id === selectedEdge.id
                          ? {
                              ...edge,
                              label: condition ? 'if…' : edgeData.isDefault ? 'default' : undefined,
                              data: { ...edge.data, condition },
                            }
                          : edge,
                      ),
                    );
                  if (sourceType !== 'condition_branch') {
                    return (
                      <p className="text-xs leading-5 text-ink-soft">
                        Conditions apply to edges leaving a condition branch node.
                      </p>
                    );
                  }
                  if (edgeData.isDefault) {
                    return (
                      <p className="text-xs leading-5 text-ink-soft">
                        The default branch is taken when no other edge condition matches.
                      </p>
                    );
                  }
                  return edgeData.condition ? (
                    <div>
                      <Label>Condition</Label>
                      <ConditionGroup
                        node={edgeData.condition}
                        fields={fields}
                        lists={listNames}
                        onChange={setCondition}
                        onRemove={() => setCondition(undefined)}
                      />
                    </div>
                  ) : (
                    <Button onClick={() => setCondition(emptyGroup())}>Add condition</Button>
                  );
                })()}
              </>
            )}

          </div>
        )}

        {/* §3.4 — validation docks along the bottom, only when there are errors */}
        {issues.length > 0 && (
          <div className="animate-card-rise absolute bottom-4 left-1/2 z-10 max-h-44 w-[560px] max-w-[calc(100%-32px)] -translate-x-1/2 overflow-y-auto rounded-[10px] border border-reject bg-reject-bg/95 p-3 backdrop-blur-md elev-md">
            <p className="mb-1 text-sm font-medium text-reject">
              {issues.length} validation issue{issues.length > 1 ? 's' : ''}
            </p>
            {issues.map((issue, index) => (
              <p key={index} className="font-mono text-xs leading-5 text-reject">
                {issue.path}: {issue.message}
              </p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
