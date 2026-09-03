import type { WorkflowGraph } from '../../../../shared/src/index';

/**
 * A.1 #3 consequence previews — find where a role is load-bearing before an
 * admin deletes it (or deactivates its last active member).
 */
export interface WorkflowRoleRef {
  id: string;
  name: string;
  version: number;
  nodes: { id: string; label: string }[];
}

interface PublishedHeadRow {
  id: string;
  name: string;
  versions: { version: number; graph: unknown }[];
}

/**
 * Prisma `select` for scanning each workflow's latest *published* version —
 * the one live requests instantiate from. Draft references are caught at
 * publish time by graph validation instead.
 */
export const PUBLISHED_HEAD_SELECT = {
  id: true,
  name: true,
  versions: {
    where: { publishedAt: { not: null } },
    orderBy: { version: 'desc' as const },
    take: 1,
    select: { version: true, graph: true },
  },
} as const;

/** Nodes in each published head that route approvals (or escalations) to `roleId`. */
export function workflowsReferencingRole(
  workflows: PublishedHeadRow[],
  roleId: string,
): WorkflowRoleRef[] {
  const refs: WorkflowRoleRef[] = [];
  for (const workflow of workflows) {
    const head = workflow.versions[0];
    if (!head) continue;
    const graph = head.graph as unknown as WorkflowGraph;
    const nodes = (graph?.nodes ?? []).filter(
      (node) => node.config?.roleId === roleId || node.config?.escalateToRoleId === roleId,
    );
    if (nodes.length > 0) {
      refs.push({
        id: workflow.id,
        name: workflow.name,
        version: head.version,
        nodes: nodes.map((node) => ({ id: node.id, label: node.label ?? node.id })),
      });
    }
  }
  return refs;
}
