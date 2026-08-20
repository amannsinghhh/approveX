import type {
  ConditionNode,
  DecisionTableColumn,
  DecisionTableRow,
  FieldInputType,
  FieldType,
  HitPolicy,
  LookupFallbackBehavior,
  RuleTraceType,
  ScoringSpec,
  StructuredTrace,
  TraceEntry,
} from '@approvex/shared';

export interface FieldDefinition {
  id: string;
  name: string;
  type: FieldType;
  description: string | null;
  /** B.2 metadata — present when the registry declares it. */
  unit?: string | null;
  precision?: number | null;
  nullable?: boolean;
  /** What a missing field is treated as during evaluation; null/absent = no default. */
  defaultIfMissing?: unknown;
  source?: 'payload' | 'computed' | 'looked_up' | null;
  /** Allowed values for an enum-style string field; empty when not an enum. */
  enumValues?: string[];
  /** B.3 #10 — external lookup config, present when source is looked_up. */
  lookupUrl?: string | null;
  lookupFallback?: LookupFallbackBehavior;
  /**
   * P0.1 Request Portal — when true the field is collected on the generated
   * request form. The rest is form copy/control config, meaningful only then.
   */
  userSubmittable?: boolean;
  /** Contexts (rule/table contexts) whose forms show this field; empty = all. */
  contexts?: string[];
  label?: string | null;
  helpText?: string | null;
  inputType?: FieldInputType | null;
  displayOrder?: number | null;
}

/** A named value list backing IN_LIST / NOT_IN_LIST membership checks. */
export interface ManagedList {
  id: string;
  name: string;
  description: string | null;
  values: string[];
  createdAt: string;
  updatedAt: string;
}

export interface RuleVersion {
  id: string;
  version: number;
  ruleType: RuleTraceType;
  /** Set iff ruleType is condition_tree. */
  conditionAst: ConditionNode | null;
  /** Set iff ruleType is scoring. Authored via the API until the M3 builder lands. */
  scoringSpec: ScoringSpec | null;
  priority: number;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  publishedAt: string | null;
  createdAt: string;
}

export interface Rule {
  id: string;
  name: string;
  description: string | null;
  context: string;
  status: 'draft' | 'published' | 'archived';
  currentVersion: number;
  createdAt: string;
  updatedAt: string;
  latestVersion: RuleVersion | null;
  versions?: RuleVersion[];
}

export interface DecisionTableVersion {
  id: string;
  version: number;
  columns: DecisionTableColumn[];
  rows: DecisionTableRow[];
  hitPolicy: HitPolicy;
  publishedAt: string | null;
  createdAt: string;
}

export interface DecisionTable {
  id: string;
  name: string;
  description: string | null;
  context: string;
  status: 'draft' | 'published' | 'archived';
  currentVersion: number;
  latestVersion: DecisionTableVersion | null;
  versions?: DecisionTableVersion[];
}

export interface DryRunResult {
  mode: 'dry_run';
  context: string;
  matched: boolean;
  matchedRuleId: string | null;
  matchedRuleName: string | null;
  matchedRuleVersion: number | null;
  priorityUsed: number | null;
  ruleType: RuleTraceType | null;
  evaluationTrace: StructuredTrace | null;
  matchesConsidered: {
    ruleId: string;
    ruleName: string;
    version: number;
    priority: number;
    ruleType: RuleTraceType;
    conditionCount: number;
    matched: boolean;
    trace?: TraceEntry[];
  }[];
  noMatch: boolean;
  noMatchPolicy: string;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

// ---------------------------------------------------------------- workflows

export interface WorkflowVersionData {
  id: string;
  version: number;
  graph: { nodes: WorkflowGraphNode[]; edges: WorkflowGraphEdge[] };
  rejectionPolicy: 'any_reject_kills' | 'reject_returns_to_previous_step';
  publishedAt: string | null;
  createdAt: string;
}

export interface WorkflowGraphNode {
  id: string;
  type: string;
  label?: string;
  config?: Record<string, unknown> & {
    roleId?: string;
    quorum?: 'all' | 'any' | { n: number };
    slaHours?: number;
    escalateToRoleId?: string | null;
    allowDelegation?: boolean;
  };
  position?: { x: number; y: number };
}

export interface WorkflowGraphEdge {
  from: string;
  to: string;
  condition?: unknown;
  isDefault?: boolean;
}

export interface WorkflowData {
  id: string;
  name: string;
  description: string | null;
  status: 'draft' | 'published' | 'archived';
  currentVersion: number;
  latestVersion: WorkflowVersionData | null;
  versions?: WorkflowVersionData[];
}

// ----------------------------------------------------------------- requests

export interface StepActionData {
  id: string;
  action: 'approve' | 'reject' | 'delegate' | 'comment';
  actorUserId: string;
  actorName: string | null;
  targetUserId: string | null;
  targetName: string | null;
  onBehalfOfUserId: string | null;
  onBehalfOfName: string | null;
  comment: string | null;
  actedAt: string;
}

export interface RequestStepData {
  id: string;
  nodeId: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled' | 'superseded';
  assignedRoleId: string;
  dueAt: string | null;
  escalatedToRoleId: string | null;
  completedAt: string | null;
  createdAt: string;
  actions: StepActionData[];
}

export interface PendingApproverData {
  stepId: string;
  nodeId: string;
  roleId: string;
  roleName: string;
  dueAt: string | null;
  eligibleUsers: { id: string; name: string }[];
}

export interface RequestDetailData {
  id: string;
  title: string | null;
  externalRef: string | null;
  context: string | null;
  payload: Record<string, unknown>;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled' | 'expired';
  createdById: string;
  createdBy: { id: string; name: string; email: string } | null;
  createdAt: string;
  completedAt: string | null;
  matchedRule: { ruleId: string; name: string; version: number } | null;
  workflowVersion: {
    id: string;
    version: number;
    workflowId: string;
    workflowName: string | null;
    rejectionPolicy: string;
    graph: { nodes: WorkflowGraphNode[]; edges: WorkflowGraphEdge[] };
  };
  steps: RequestStepData[];
  pendingApprovers: PendingApproverData[];
}

export interface RequestListItem {
  id: string;
  title: string | null;
  externalRef: string | null;
  context: string | null;
  status: string;
  createdById: string;
  createdAt: string;
  completedAt: string | null;
  pendingSteps: { id: string; nodeId: string; assignedRoleId: string; dueAt: string | null }[];
}

export interface InboxItem {
  id: string;
  nodeId: string;
  status: string;
  dueAt: string | null;
  createdAt: string;
  request: {
    id: string;
    title: string | null;
    externalRef: string | null;
    context: string | null;
    payload: Record<string, unknown>;
    status: string;
    createdById: string;
    createdByName: string | null;
    createdAt: string;
  };
}

// ------------------------------------------------------------------- portal
// P0.1 Request Portal — the self-service surface. Mirrors the shapes the
// PortalController returns (apps/api/src/portal/*).

/** One submission type the current user can pick from on /submit. */
export interface PortalContext {
  context: string;
  fieldCount: number;
}

/** A user-submittable field, projected into what the form renderer needs. */
export interface PortalFormField {
  name: string;
  type: FieldType;
  label: string;
  helpText: string | null;
  inputType: FieldInputType;
  required: boolean;
  enumValues: string[];
  unit: string | null;
  precision: number | null;
}

export interface PortalForm {
  context: string;
  fields: PortalFormField[];
}

/** What the requester learns became of their submission. */
export interface PortalSubmitResult {
  requestId: string | null;
  status: string | null;
  pendingApprovers: unknown;
}

/** A row in /my-requests — the requester's own submissions. */
export interface MyRequestItem {
  id: string;
  title: string | null;
  externalRef: string | null;
  context: string | null;
  status: string;
  createdAt: string;
  completedAt: string | null;
  pendingSteps: { id: string; nodeId: string; assignedRoleId: string | null; dueAt: string | null }[];
}
