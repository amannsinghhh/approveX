import { describe, expect, it } from 'vitest';
import type { WorkflowGraph } from '../../shared/src/workflow/types';
import { validateWorkflowGraph } from '../../shared/src/workflow/validate';

const ROLE_MGR = 'role-mgr';
const ROLE_FIN = 'role-fin';
const roleIds = new Set([ROLE_MGR, ROLE_FIN]);

const approval = (id: string, roleId = ROLE_MGR, extra = {}) => ({
  id,
  type: 'approval' as const,
  config: { roleId, ...extra },
});

const linear = (): WorkflowGraph => ({
  nodes: [
    { id: 'start', type: 'start' },
    approval('mgr'),
    approval('fin', ROLE_FIN),
    { id: 'done', type: 'auto_approve' },
  ],
  edges: [
    { from: 'start', to: 'mgr' },
    { from: 'mgr', to: 'fin' },
    { from: 'fin', to: 'done' },
  ],
});

describe('validateWorkflowGraph', () => {
  it('accepts a valid linear approval chain', () => {
    expect(validateWorkflowGraph(linear(), { roleIds })).toEqual({ valid: true, issues: [] });
  });

  it('accepts a parallel fork that reconverges', () => {
    const graph: WorkflowGraph = {
      nodes: [
        { id: 'start', type: 'start' },
        { id: 'fork', type: 'parallel' },
        approval('mgr'),
        approval('fin', ROLE_FIN),
        { id: 'done', type: 'auto_approve' },
      ],
      edges: [
        { from: 'start', to: 'fork' },
        { from: 'fork', to: 'mgr' },
        { from: 'fork', to: 'fin' },
        { from: 'mgr', to: 'done' },
        { from: 'fin', to: 'done' },
      ],
    };
    expect(validateWorkflowGraph(graph, { roleIds }).valid).toBe(true);
  });

  it('rejects cycles with the nodes involved', () => {
    const graph = linear();
    graph.edges.push({ from: 'fin', to: 'mgr' });
    // also remove terminal edge so the cycle is strict
    const result = validateWorkflowGraph(graph, { roleIds });
    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.message).join()).toContain('Cycle detected');
  });

  it('rejects orphan nodes', () => {
    const graph = linear();
    graph.nodes.push(approval('island', ROLE_FIN));
    const result = validateWorkflowGraph(graph, { roleIds });
    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.message).join()).toContain('Orphan nodes');
    expect(result.issues.map((issue) => issue.message).join()).toContain('island');
  });

  it.each([
    ['zero starts', (graph: WorkflowGraph) => graph.nodes.splice(0, 1), 'Exactly one start'],
    [
      'two starts',
      (graph: WorkflowGraph) => graph.nodes.push({ id: 'start2', type: 'start' }),
      'Exactly one start',
    ],
    [
      'unknown role',
      (graph: WorkflowGraph) => {
        graph.nodes[1] = approval('mgr', 'ghost-role');
      },
      'role that does not exist',
    ],
    [
      'missing roleId',
      (graph: WorkflowGraph) => {
        graph.nodes[1] = { id: 'mgr', type: 'approval', config: {} };
      },
      'needs config.roleId',
    ],
    [
      'bad quorum',
      (graph: WorkflowGraph) => {
        graph.nodes[1] = approval('mgr', ROLE_MGR, { quorum: { n: 0 } });
      },
      'invalid quorum',
    ],
    [
      'edge to nowhere',
      (graph: WorkflowGraph) => graph.edges.push({ from: 'mgr', to: 'ghost' }),
      'does not exist',
    ],
    [
      'terminal with outgoing edge',
      (graph: WorkflowGraph) => graph.edges.push({ from: 'done', to: 'mgr' }),
      'terminal',
    ],
    [
      'condition on a normal edge',
      (graph: WorkflowGraph) => {
        graph.edges[1] = {
          from: 'mgr',
          to: 'fin',
          condition: { field: 'x', operator: '=', value: 1 },
        };
      },
      'Only condition_branch nodes',
    ],
  ])('rejects %s', (_label, mutate, fragment) => {
    const graph = linear();
    mutate(graph);
    const result = validateWorkflowGraph(graph, { roleIds });
    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.message).join(' | ')).toContain(fragment);
  });

  it('validates condition_branch edges', () => {
    const graph: WorkflowGraph = {
      nodes: [
        { id: 'start', type: 'start' },
        { id: 'route', type: 'condition_branch' },
        approval('mgr'),
        approval('fin', ROLE_FIN),
      ],
      edges: [
        { from: 'start', to: 'route' },
        { from: 'route', to: 'mgr', condition: { field: 'amount', operator: '>', value: 100 } },
        { from: 'route', to: 'fin', isDefault: true },
      ],
    };
    expect(validateWorkflowGraph(graph, { roleIds }).valid).toBe(true);

    // Edge without condition or default
    graph.edges[2] = { from: 'route', to: 'fin' };
    const result = validateWorkflowGraph(graph, { roleIds });
    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.message).join()).toContain(
      'needs a condition or isDefault',
    );
  });

  it('rejects exclusive branches reconverging into a join', () => {
    const graph: WorkflowGraph = {
      nodes: [
        { id: 'start', type: 'start' },
        { id: 'route', type: 'condition_branch' },
        approval('mgr'),
        { id: 'join', type: 'auto_approve' },
      ],
      edges: [
        { from: 'start', to: 'route' },
        { from: 'route', to: 'mgr', condition: { field: 'a', operator: '=', value: 1 } },
        { from: 'route', to: 'join', isDefault: true },
        { from: 'mgr', to: 'join' },
      ],
    };
    const result = validateWorkflowGraph(graph, { roleIds });
    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.message).join()).toContain('cannot reconverge');
  });

  it('reject_returns_to_previous_step demands a linear chain', () => {
    expect(
      validateWorkflowGraph(linear(), {
        roleIds,
        rejectionPolicy: 'reject_returns_to_previous_step',
      }).valid,
    ).toBe(true);

    const forked: WorkflowGraph = {
      nodes: [
        { id: 'start', type: 'start' },
        approval('mgr'),
        approval('fin', ROLE_FIN),
        { id: 'done', type: 'auto_approve' },
      ],
      edges: [
        { from: 'start', to: 'mgr' },
        { from: 'start', to: 'fin' },
        { from: 'mgr', to: 'done' },
        { from: 'fin', to: 'done' },
      ],
    };
    const result = validateWorkflowGraph(forked, {
      roleIds,
      rejectionPolicy: 'reject_returns_to_previous_step',
    });
    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.message).join()).toContain('linear');
  });

  it('works without a roleIds set (structure-only validation)', () => {
    expect(validateWorkflowGraph(linear()).valid).toBe(true);
  });
});
