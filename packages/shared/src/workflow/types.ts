import type { ConditionNode } from '../rule-evaluator/types';

export const WORKFLOW_NODE_TYPES = [
  'start',
  'approval',
  'parallel',
  'auto_approve',
  'auto_reject',
  'webhook_call',
  'wait',
  'condition_branch',
] as const;
export type WorkflowNodeType = (typeof WORKFLOW_NODE_TYPES)[number];

export type Quorum = 'all' | 'any' | { n: number };

export interface ApprovalNodeConfig {
  roleId: string;
  quorum?: Quorum;
  slaHours?: number;
  escalateToRoleId?: string | null;
  allowDelegation?: boolean;
}

export interface WorkflowNode {
  /** Author-chosen slug, unique within the graph, e.g. "manager_approval". */
  id: string;
  type: WorkflowNodeType;
  label?: string;
  config?: Partial<ApprovalNodeConfig> & {
    /** webhook_call (executed from Phase 6) */
    url?: string;
    /** wait duration (executed from Phase 6) */
    hours?: number;
  };
}

export interface WorkflowEdge {
  from: string;
  to: string;
  /** Only on edges leaving a condition_branch node. */
  condition?: ConditionNode;
  /** Fallback edge of a condition_branch when no condition matches. */
  isDefault?: boolean;
}

export interface WorkflowGraph {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

export const REJECTION_POLICIES = ['any_reject_kills', 'reject_returns_to_previous_step'] as const;
export type RejectionPolicy = (typeof REJECTION_POLICIES)[number];

export const edgeKey = (edge: Pick<WorkflowEdge, 'from' | 'to'>): string =>
  `${edge.from}->${edge.to}`;
