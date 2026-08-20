import { validateConditionAst } from '../rule-evaluator/validate';
import type { ValidationIssue } from '../rule-evaluator/validate';
import type { RejectionPolicy, WorkflowGraph } from './types';
import { edgeKey, WORKFLOW_NODE_TYPES } from './types';

const NODE_ID_PATTERN = /^[a-z][a-z0-9_]*$/;
const MAX_NODES = 100;

export interface WorkflowValidationOptions {
  /** When provided, approval/escalation roles must be members of this set. */
  roleIds?: Set<string>;
  /** reject_returns_to_previous_step demands a strictly linear approval chain. */
  rejectionPolicy?: RejectionPolicy;
}

/**
 * Structural validation for workflow graphs (spec §6): exactly one start,
 * no orphans, no cycles, approval nodes reference existing roles, quorum
 * shapes valid, condition edges only out of condition_branch nodes, and no
 * AND-join fed directly by a condition_branch (exclusive paths would deadlock
 * the join). Shared with the Phase 5 builder UI.
 */
export function validateWorkflowGraph(
  graph: unknown,
  options: WorkflowValidationOptions = {},
): { valid: boolean; issues: ValidationIssue[] } {
  const issues: ValidationIssue[] = [];
  const push = (path: string, message: string): void => {
    issues.push({ path, message });
  };

  if (
    graph === null ||
    typeof graph !== 'object' ||
    !Array.isArray((graph as WorkflowGraph).nodes) ||
    !Array.isArray((graph as WorkflowGraph).edges)
  ) {
    return {
      valid: false,
      issues: [{ path: 'graph', message: 'Graph must be { nodes: [...], edges: [...] }' }],
    };
  }
  const { nodes, edges } = graph as WorkflowGraph;

  if (nodes.length === 0) push('nodes', 'At least one node is required');
  if (nodes.length > MAX_NODES) push('nodes', `Graph exceeds the maximum of ${MAX_NODES} nodes`);

  // --- nodes
  const nodeById = new Map<string, WorkflowGraph['nodes'][number]>();
  nodes.forEach((node, index) => {
    const path = `nodes[${index}]`;
    if (!node || typeof node.id !== 'string' || !NODE_ID_PATTERN.test(node.id)) {
      push(path, 'Node needs an id (lowercase letters, digits, underscores)');
      return;
    }
    if (nodeById.has(node.id)) push(path, `Duplicate node id "${node.id}"`);
    nodeById.set(node.id, node);
    if (!WORKFLOW_NODE_TYPES.includes(node.type)) {
      push(path, `Unknown node type "${String(node.type)}"`);
      return;
    }
    if (node.type === 'approval') {
      const config = node.config ?? {};
      if (typeof config.roleId !== 'string' || config.roleId.length === 0) {
        push(path, `Approval node "${node.id}" needs config.roleId`);
      } else if (options.roleIds && !options.roleIds.has(config.roleId)) {
        push(path, `Approval node "${node.id}" references a role that does not exist`);
      }
      const quorum = config.quorum ?? 'all';
      const quorumOk =
        quorum === 'all' ||
        quorum === 'any' ||
        (typeof quorum === 'object' &&
          quorum !== null &&
          Number.isInteger((quorum as { n: number }).n) &&
          (quorum as { n: number }).n >= 1);
      if (!quorumOk) push(path, `Approval node "${node.id}" has an invalid quorum`);
      if (
        config.slaHours !== undefined &&
        (typeof config.slaHours !== 'number' || config.slaHours <= 0)
      ) {
        push(path, `Approval node "${node.id}" slaHours must be a positive number`);
      }
      if (
        config.escalateToRoleId &&
        options.roleIds &&
        !options.roleIds.has(config.escalateToRoleId)
      ) {
        push(path, `Approval node "${node.id}" escalation role does not exist`);
      }
    }
  });

  const startNodes = nodes.filter((node) => node?.type === 'start');
  if (startNodes.length !== 1) {
    push('nodes', `Exactly one start node is required (found ${startNodes.length})`);
  }

  // --- edges
  const outgoing = new Map<string, WorkflowGraph['edges']>();
  const incoming = new Map<string, WorkflowGraph['edges']>();
  const seenEdges = new Set<string>();
  edges.forEach((edge, index) => {
    const path = `edges[${index}]`;
    if (!edge || typeof edge.from !== 'string' || typeof edge.to !== 'string') {
      push(path, 'Edge needs from and to node ids');
      return;
    }
    if (!nodeById.has(edge.from)) push(path, `Edge source "${edge.from}" does not exist`);
    if (!nodeById.has(edge.to)) push(path, `Edge target "${edge.to}" does not exist`);
    if (edge.from === edge.to) push(path, `Edge "${edge.from}" cannot point at itself`);
    const key = edgeKey(edge);
    if (seenEdges.has(key)) push(path, `Duplicate edge ${key}`);
    seenEdges.add(key);

    outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge]);
    incoming.set(edge.to, [...(incoming.get(edge.to) ?? []), edge]);

    const source = nodeById.get(edge.from);
    if (edge.condition !== undefined) {
      if (source && source.type !== 'condition_branch') {
        push(path, `Only condition_branch nodes may have conditional edges (${key})`);
      } else {
        const result = validateConditionAst(edge.condition);
        result.issues.forEach((issue) => push(`${path}.condition.${issue.path}`, issue.message));
      }
    }
    if (edge.isDefault && source && source.type !== 'condition_branch') {
      push(path, `Only condition_branch nodes may have a default edge (${key})`);
    }
  });

  for (const node of nodeById.values()) {
    const out = outgoing.get(node.id) ?? [];
    const into = incoming.get(node.id) ?? [];
    if (node.type === 'start' && into.length > 0) {
      push(`nodes(${node.id})`, 'The start node cannot have incoming edges');
    }
    if ((node.type === 'auto_approve' || node.type === 'auto_reject') && out.length > 0) {
      push(`nodes(${node.id})`, `${node.type} is terminal and cannot have outgoing edges`);
    }
    if (node.type === 'condition_branch') {
      if (out.length === 0) {
        push(`nodes(${node.id})`, 'condition_branch needs at least one outgoing edge');
      }
      const withoutCondition = out.filter(
        (edge) => edge.condition === undefined && !edge.isDefault,
      );
      if (withoutCondition.length > 0) {
        push(
          `nodes(${node.id})`,
          'Every edge out of a condition_branch needs a condition or isDefault',
        );
      }
      if (out.filter((edge) => edge.isDefault).length > 1) {
        push(`nodes(${node.id})`, 'condition_branch can have at most one default edge');
      }
    }
    // AND-join deadlock guard: exclusive (conditional) paths must not reconverge.
    if (into.length > 1) {
      const conditionalFeeds = into.filter(
        (edge) => nodeById.get(edge.from)?.type === 'condition_branch',
      );
      if (conditionalFeeds.length > 0) {
        push(
          `nodes(${node.id})`,
          `"${node.id}" joins multiple branches but is fed by a condition_branch — exclusive paths cannot reconverge into a join`,
        );
      }
    }
  }

  // --- cycles (Kahn) + reachability
  if (issues.length === 0) {
    const inDegree = new Map<string, number>();
    for (const id of nodeById.keys()) inDegree.set(id, incoming.get(id)?.length ?? 0);
    const queue = [...nodeById.keys()].filter((id) => inDegree.get(id) === 0);
    let visited = 0;
    while (queue.length > 0) {
      const id = queue.shift() as string;
      visited += 1;
      for (const edge of outgoing.get(id) ?? []) {
        const next = (inDegree.get(edge.to) ?? 0) - 1;
        inDegree.set(edge.to, next);
        if (next === 0) queue.push(edge.to);
      }
    }
    if (visited !== nodeById.size) {
      const cycleNodes = [...inDegree.entries()]
        .filter(([, degree]) => degree > 0)
        .map(([id]) => id);
      push('graph', `Cycle detected involving: ${cycleNodes.join(' → ')}`);
    }

    const start = startNodes[0];
    if (start) {
      const reachable = new Set<string>([start.id]);
      const stack = [start.id];
      while (stack.length > 0) {
        const id = stack.pop() as string;
        for (const edge of outgoing.get(id) ?? []) {
          if (!reachable.has(edge.to)) {
            reachable.add(edge.to);
            stack.push(edge.to);
          }
        }
      }
      const orphans = [...nodeById.keys()].filter((id) => !reachable.has(id));
      if (orphans.length > 0) {
        push('graph', `Orphan nodes not reachable from start: ${orphans.join(', ')}`);
      }
    }
  }

  // --- rejection policy constraint
  if (options.rejectionPolicy === 'reject_returns_to_previous_step') {
    const forks = nodes.filter(
      (node) =>
        node?.type !== 'condition_branch' && (outgoing.get(node?.id ?? '') ?? []).length > 1,
    );
    const joins = [...nodeById.keys()].filter((id) => (incoming.get(id) ?? []).length > 1);
    if (forks.length > 0 || joins.length > 0) {
      push(
        'graph',
        'reject_returns_to_previous_step requires a linear workflow (no parallel forks or joins)',
      );
    }
  }

  return { valid: issues.length === 0, issues };
}
