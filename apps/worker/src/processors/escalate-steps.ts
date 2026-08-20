import type { ApprovalNodeConfig, WorkflowGraph } from '@approvex/shared';
import type { PrismaClient } from '@prisma/client';
import { enqueueOutbox } from '../outbox';

/**
 * SLA escalation timers (spec Phase 6). A pending step past its due_at is
 * handled exactly once (sla_breached_at is the marker):
 *
 *  - node has escalateToRoleId → the step is REASSIGNED to that role
 *    (assigned_role_id changes, so eligibility/inbox/quorum all follow),
 *    notified_at resets so the new role gets emailed, and a step.escalated
 *    audit event + webhook fire.
 *  - no escalation role → flag it (step.sla_breached audit event) and leave
 *    the assignment as is; the SLA meter in the UI already shows the breach.
 */

export interface EscalationStats {
  escalated: number;
  flagged: number;
}

export async function escalateOverdueSteps(
  prisma: PrismaClient,
  now: () => Date = () => new Date(),
): Promise<EscalationStats> {
  const stats: EscalationStats = { escalated: 0, flagged: 0 };
  const due = await prisma.requestStep.findMany({
    where: { status: 'pending', slaBreachedAt: null, dueAt: { lte: now() } },
    take: 50,
    include: {
      request: { select: { id: true, workflowVersion: { select: { graph: true } } } },
    },
  });

  for (const step of due) {
    await prisma.$transaction(async (tx) => {
      // Same row, one winner: recheck under lock, skip if another worker or an
      // in-flight approval got here first.
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM request_steps
        WHERE id = ${step.id}::uuid AND status = 'pending' AND sla_breached_at IS NULL
        FOR UPDATE SKIP LOCKED
      `;
      if (locked.length === 0) return;

      const graph = step.request.workflowVersion.graph as unknown as WorkflowGraph;
      const node = graph.nodes.find((candidate) => candidate.id === step.nodeId);
      const config = (node?.config ?? {}) as ApprovalNodeConfig;
      const breachedAt = now();

      if (config.escalateToRoleId && !step.escalatedToRoleId) {
        await tx.requestStep.update({
          where: { id: step.id },
          data: {
            assignedRoleId: config.escalateToRoleId,
            escalatedToRoleId: config.escalateToRoleId,
            slaBreachedAt: breachedAt,
            notifiedAt: null,
          },
        });
        await tx.auditEvent.create({
          data: {
            tenantId: step.tenantId,
            actorType: 'system',
            eventType: 'step.escalated',
            entityType: 'request_step',
            entityId: step.id,
            after: {
              reason: 'sla_breach',
              requestId: step.requestId,
              nodeId: step.nodeId,
              from: step.assignedRoleId,
              to: config.escalateToRoleId,
              dueAt: step.dueAt?.toISOString() ?? null,
            },
          },
        });
        await enqueueOutbox(tx, step.tenantId, 'step.escalated', {
          requestId: step.requestId,
          stepId: step.id,
          nodeId: step.nodeId,
          fromRoleId: step.assignedRoleId,
          toRoleId: config.escalateToRoleId,
          dueAt: step.dueAt?.toISOString() ?? null,
        });
        stats.escalated += 1;
      } else {
        await tx.requestStep.update({
          where: { id: step.id },
          data: { slaBreachedAt: breachedAt },
        });
        await tx.auditEvent.create({
          data: {
            tenantId: step.tenantId,
            actorType: 'system',
            eventType: 'step.sla_breached',
            entityType: 'request_step',
            entityId: step.id,
            after: {
              requestId: step.requestId,
              nodeId: step.nodeId,
              dueAt: step.dueAt?.toISOString() ?? null,
            },
          },
        });
        stats.flagged += 1;
      }
    });
  }
  return stats;
}
