import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type {
  ApprovalNodeConfig,
  WorkflowEdge,
  WorkflowGraph,
  WorkflowNode,
} from '../../../../shared/src/index';
import { edgeKey, evaluateCondition } from '../../../../shared/src/index';
import type { Prisma, RequestStatus } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { OutboxService } from '../webhooks/outbox.service';

/** Persisted on requests.engine_state — completed nodes + delivered edges of the pinned graph. */
interface EngineState {
  completed: string[];
  delivered: string[];
}

interface InstantiateParams {
  tenantId: string;
  actorUserId: string;
  workflowVersion: { id: string; graph: unknown; rejectionPolicy: string };
  payload: Record<string, unknown>;
  context?: string;
  title?: string;
  externalRef?: string;
  matchedRuleVersionId?: string;
  idempotencyKey?: string;
  ip?: string;
}

export interface PendingApprover {
  stepId: string;
  nodeId: string;
  roleId: string;
  roleName: string;
  dueAt: string | null;
  eligibleUsers: { id: string; name: string }[];
}

type Tx = Prisma.TransactionClient;

const asGraph = (graph: unknown): WorkflowGraph => graph as WorkflowGraph;
const approvalConfig = (node: WorkflowNode): ApprovalNodeConfig =>
  (node.config ?? {}) as ApprovalNodeConfig;

@Injectable()
export class RequestEngineService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  // ---------------------------------------------------------------- helpers

  private node(graph: WorkflowGraph, nodeId: string): WorkflowNode {
    const node = graph.nodes.find((candidate) => candidate.id === nodeId);
    if (!node) throw new ConflictException(`Pinned graph is missing node "${nodeId}"`);
    return node;
  }

  private outgoing(graph: WorkflowGraph, nodeId: string): WorkflowEdge[] {
    return graph.edges.filter((edge) => edge.from === nodeId);
  }

  private incoming(graph: WorkflowGraph, nodeId: string): WorkflowEdge[] {
    return graph.edges.filter((edge) => edge.to === nodeId);
  }

  /** Active role members minus the request creator — maker-checker at the root. */
  private async eligibleMembers(
    tx: Tx,
    roleId: string,
    creatorId: string,
  ): Promise<{ id: string; name: string }[]> {
    const memberships = await tx.userRole.findMany({
      where: { roleId, user: { status: 'active' } },
      select: { user: { select: { id: true, name: true } } },
    });
    return memberships.map((m) => m.user).filter((user) => user.id !== creatorId);
  }

  /**
   * Spec scenario: creator is the only member of an approver role → escalate,
   * or block with a clear error BEFORE the request is created.
   */
  private async preflightApprovability(
    tx: Tx,
    graph: WorkflowGraph,
    creatorId: string,
  ): Promise<void> {
    for (const node of graph.nodes) {
      if (node.type !== 'approval') continue;
      const config = approvalConfig(node);
      const members = await this.eligibleMembers(tx, config.roleId, creatorId);
      if (members.length > 0) continue;

      if (config.escalateToRoleId) {
        const escalated = await this.eligibleMembers(tx, config.escalateToRoleId, creatorId);
        if (escalated.length > 0) continue;
      }
      const role = await tx.role.findUnique({ where: { id: config.roleId } });
      throw new UnprocessableEntityException(
        `Step "${node.label ?? node.id}" has no eligible approver: every active member of ` +
          `role "${role?.name ?? config.roleId}" is excluded (the requester cannot approve their ` +
          `own request) and no escalation role is available. Add another member or configure escalation.`,
      );
    }
  }

  // ------------------------------------------------------------ instantiate

  async instantiate(params: InstantiateParams) {
    const graph = asGraph(params.workflowVersion.graph);

    const requestId = await this.tenantPrisma.transactionForTenant(params.tenantId, async (tx) => {
      await this.preflightApprovability(tx, graph, params.actorUserId);

      const request = await tx.request.create({
        data: {
          tenantId: params.tenantId,
          payload: params.payload as Prisma.InputJsonValue,
          context: params.context,
          title: params.title,
          externalRef: params.externalRef,
          matchedRuleVersionId: params.matchedRuleVersionId,
          workflowVersionId: params.workflowVersion.id,
          idempotencyKey: params.idempotencyKey,
          createdById: params.actorUserId,
          engineState: { completed: [], delivered: [] } as unknown as Prisma.InputJsonValue,
        },
      });

      await this.outbox.enqueueForRequest(tx, params.tenantId, 'request.created', request.id);

      const state: EngineState = { completed: [], delivered: [] };
      const start = graph.nodes.find((node) => node.type === 'start');
      if (!start) throw new ConflictException('Pinned graph has no start node');
      await this.completeNode(
        tx,
        request.id,
        params.tenantId,
        graph,
        start.id,
        state,
        params.payload,
        params.actorUserId,
      );
      await this.persistState(tx, request.id, state);
      await this.settleIfIdle(tx, request.id, params.tenantId, state, graph);
      return request.id;
    });

    await this.audit.record({
      tenantId: params.tenantId,
      actorUserId: params.actorUserId,
      eventType: 'request.created',
      entityType: 'request',
      entityId: requestId,
      after: { context: params.context, externalRef: params.externalRef },
      ip: params.ip,
    });

    return this.describe(params.tenantId, requestId);
  }

  private async persistState(tx: Tx, requestId: string, state: EngineState): Promise<void> {
    await tx.request.update({
      where: { id: requestId },
      data: { engineState: state as unknown as Prisma.InputJsonValue },
    });
  }

  /** A request with nothing pending and no terminal reached resolves as approved. */
  private async settleIfIdle(
    tx: Tx,
    requestId: string,
    tenantId: string,
    _state: EngineState,
    _graph: WorkflowGraph,
  ): Promise<void> {
    const request = await tx.request.findUniqueOrThrow({ where: { id: requestId } });
    if (request.status !== 'pending') return;
    const open = await tx.requestStep.count({ where: { requestId, status: 'pending' } });
    if (open === 0) {
      await this.finalize(tx, requestId, tenantId, 'approved');
    }
  }

  // ------------------------------------------------------- graph traversal

  private async completeNode(
    tx: Tx,
    requestId: string,
    tenantId: string,
    graph: WorkflowGraph,
    nodeId: string,
    state: EngineState,
    payload: Record<string, unknown>,
    creatorId: string,
  ): Promise<void> {
    if (!state.completed.includes(nodeId)) state.completed.push(nodeId);

    const node = this.node(graph, nodeId);
    let edges = this.outgoing(graph, nodeId);

    if (node.type === 'condition_branch') {
      const matching = edges.find(
        (edge) =>
          edge.condition !== undefined && evaluateCondition(edge.condition, payload).matched,
      );
      const chosen = matching ?? edges.find((edge) => edge.isDefault);
      if (!chosen) {
        // Dead end on an exclusive branch: nothing can ever progress — reject.
        await this.audit.record({
          tenantId,
          eventType: 'request.branch_dead_end',
          entityType: 'request',
          entityId: requestId,
          actorType: 'system',
          after: { nodeId },
        });
        await this.finalize(tx, requestId, tenantId, 'rejected');
        return;
      }
      edges = [chosen];
    }

    for (const edge of edges) {
      const key = edgeKey(edge);
      if (!state.delivered.includes(key)) state.delivered.push(key);

      const inbound = this.incoming(graph, edge.to);
      const joinReady = inbound.every((incomingEdge) =>
        state.delivered.includes(edgeKey(incomingEdge)),
      );
      if (joinReady) {
        await this.activateNode(tx, requestId, tenantId, graph, edge.to, state, payload, creatorId);
        // finalized mid-walk? stop delivering further edges
        const request = await tx.request.findUniqueOrThrow({ where: { id: requestId } });
        if (request.status !== 'pending') return;
      }
    }
  }

  private async activateNode(
    tx: Tx,
    requestId: string,
    tenantId: string,
    graph: WorkflowGraph,
    nodeId: string,
    state: EngineState,
    payload: Record<string, unknown>,
    creatorId: string,
  ): Promise<void> {
    const node = this.node(graph, nodeId);

    switch (node.type) {
      case 'approval': {
        const config = approvalConfig(node);
        let assignedRoleId = config.roleId;
        let escalatedToRoleId: string | null = null;

        const members = await this.eligibleMembers(tx, config.roleId, creatorId);
        if (members.length === 0 && config.escalateToRoleId) {
          assignedRoleId = config.escalateToRoleId;
          escalatedToRoleId = config.escalateToRoleId;
        }

        const step = await tx.requestStep.create({
          data: {
            tenantId,
            requestId,
            nodeId,
            assignedRoleId,
            escalatedToRoleId,
            dueAt: config.slaHours ? new Date(Date.now() + config.slaHours * 3600_000) : null,
          },
        });
        if (escalatedToRoleId) {
          await this.audit.record({
            tenantId,
            eventType: 'step.escalated',
            entityType: 'request_step',
            entityId: step.id,
            actorType: 'system',
            after: { reason: 'no_eligible_approver', from: config.roleId, to: escalatedToRoleId },
          });
        }
        return;
      }
      case 'auto_approve':
        state.completed.push(nodeId);
        await this.finalize(tx, requestId, tenantId, 'approved');
        return;
      case 'auto_reject':
        state.completed.push(nodeId);
        await this.finalize(tx, requestId, tenantId, 'rejected');
        return;
      case 'webhook_call': {
        // Fire-and-forget: the signed event goes through the outbox (plus the
        // node's inline URL, if configured) and the workflow continues — a
        // slow receiver must never block an approval chain.
        const config = (node.config ?? {}) as { url?: string };
        const enqueued = await this.outbox.enqueueForRequest(
          tx,
          tenantId,
          'workflow.webhook_call',
          requestId,
          { nodeId, label: node.label ?? null },
          { inlineUrl: config.url },
        );
        await this.audit.record({
          tenantId,
          eventType: 'workflow.webhook_call',
          entityType: 'request',
          entityId: requestId,
          actorType: 'system',
          after: { nodeId, url: config.url ?? null, enqueued },
        });
        await this.completeNode(tx, requestId, tenantId, graph, nodeId, state, payload, creatorId);
        return;
      }
      case 'wait':
        // Timed resumes arrive in Phase 7; pass through for now.
        await this.audit.record({
          tenantId,
          eventType: 'workflow.node_passthrough',
          entityType: 'request',
          entityId: requestId,
          actorType: 'system',
          after: { nodeId, type: node.type, note: 'executes from Phase 7' },
        });
        await this.completeNode(tx, requestId, tenantId, graph, nodeId, state, payload, creatorId);
        return;
      case 'start':
      case 'parallel':
      case 'condition_branch':
        await this.completeNode(tx, requestId, tenantId, graph, nodeId, state, payload, creatorId);
        return;
    }
  }

  private async finalize(
    tx: Tx,
    requestId: string,
    tenantId: string,
    status: Extract<RequestStatus, 'approved' | 'rejected' | 'cancelled'>,
  ): Promise<void> {
    await tx.request.update({
      where: { id: requestId },
      data: { status, completedAt: new Date() },
    });
    await tx.requestStep.updateMany({
      where: { requestId, status: 'pending' },
      data: { status: 'cancelled', completedAt: new Date() },
    });
    await this.outbox.enqueueForRequest(tx, tenantId, `request.${status}`, requestId);
    await this.audit.record({
      tenantId,
      eventType: `request.${status}`,
      entityType: 'request',
      entityId: requestId,
      actorType: 'system',
    });
  }

  // ------------------------------------------------------------------- act

  async act(
    tenantId: string,
    actor: { userId: string },
    stepId: string,
    action: 'approve' | 'reject' | 'delegate' | 'comment',
    body: { comment?: string; toUserId?: string },
    ip?: string,
    // Where the action came from. Defaults to an authenticated web session;
    // no-login email/whatsapp links pass their channel so it lands on the
    // step_action row (and from there into the compliance export).
    channel: 'web' | 'email' | 'whatsapp' | 'api' | 'tally' = 'web',
  ) {
    const outcome = await this.tenantPrisma.transactionForTenant(tenantId, async (tx) => {
      // Lock order: request first, then step — serializes all engine
      // transitions for a request and makes double-submits deterministic.
      const bare = await tx.requestStep.findUnique({ where: { id: stepId } });
      if (!bare) throw new NotFoundException('Step not found');
      await tx.$queryRaw`SELECT id FROM requests WHERE id = ${bare.requestId}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM request_steps WHERE id = ${stepId}::uuid FOR UPDATE`;

      const step = await tx.requestStep.findUniqueOrThrow({
        where: { id: stepId },
        include: { request: { include: { workflowVersion: true } } },
      });
      const request = step.request;

      if (request.status !== 'pending' || step.status !== 'pending') {
        throw new ConflictException('This step is already completed');
      }

      const graph = asGraph(request.workflowVersion.graph);
      const node = this.node(graph, step.nodeId);
      const config = approvalConfig(node);

      // ----- eligibility (maker-checker included)
      if (actor.userId === request.createdById) {
        throw new ForbiddenException('Requesters cannot act on their own request');
      }
      const actorUser = await tx.user.findFirst({
        where: { id: actor.userId, status: 'active' },
      });
      if (!actorUser) throw new ForbiddenException('User is not active');

      const [isMember, adHocDelegate, oooDelegations] = await Promise.all([
        tx.userRole.findFirst({
          where: { userId: actor.userId, roleId: step.assignedRoleId },
        }),
        tx.stepAction.findFirst({
          where: { stepId, action: 'delegate', targetUserId: actor.userId },
        }),
        tx.delegation.findMany({
          where: {
            toUserId: actor.userId,
            startsAt: { lte: new Date() },
            endsAt: { gte: new Date() },
          },
        }),
      ]);

      let onBehalfOfUserId: string | null = null;
      if (!isMember && !adHocDelegate) {
        // OOO: acting for a role member who is themselves eligible
        const memberIds = new Set(
          (await this.eligibleMembers(tx, step.assignedRoleId, request.createdById)).map(
            (member) => member.id,
          ),
        );
        const covering = oooDelegations.find((delegation) => memberIds.has(delegation.fromUserId));
        if (!covering) {
          throw new ForbiddenException('You are not an eligible approver for this step');
        }
        onBehalfOfUserId = covering.fromUserId;
      }

      const alreadyActed = await tx.stepAction.findFirst({
        where: { stepId, actorUserId: actor.userId, action: { in: ['approve', 'reject'] } },
      });
      if ((action === 'approve' || action === 'reject') && alreadyActed) {
        throw new ConflictException('You have already acted on this step');
      }

      if (action === 'delegate') {
        if (config.allowDelegation === false) {
          throw new ForbiddenException('Delegation is not allowed on this step');
        }
        const target = await tx.user.findFirst({
          where: { id: body.toUserId, status: 'active' },
        });
        if (!target) throw new NotFoundException('Delegate user not found');
        if (target.id === request.createdById) {
          throw new ForbiddenException('The requester cannot receive a delegation');
        }
      }

      await tx.stepAction.create({
        data: {
          tenantId,
          stepId,
          actorUserId: actor.userId,
          action,
          comment: body.comment,
          targetUserId: action === 'delegate' ? body.toUserId : null,
          onBehalfOfUserId,
          channel,
        },
      });

      // ----- consequences
      if (action === 'approve') {
        const approvals = await tx.stepAction.count({ where: { stepId, action: 'approve' } });
        const eligible = await this.eligibleMembers(tx, step.assignedRoleId, request.createdById);
        const quorum = config.quorum ?? 'all';
        const required =
          quorum === 'any'
            ? 1
            : quorum === 'all'
              ? Math.max(eligible.length, 1)
              : Math.max(Math.min(quorum.n, Math.max(eligible.length, 1)), 1);

        if (approvals >= required) {
          await tx.requestStep.update({
            where: { id: stepId },
            data: { status: 'approved', completedAt: new Date() },
          });
          const state = request.engineState as unknown as EngineState;
          await this.completeNode(
            tx,
            request.id,
            tenantId,
            graph,
            step.nodeId,
            state,
            request.payload as Record<string, unknown>,
            request.createdById,
          );
          await this.persistState(tx, request.id, state);
          await this.settleIfIdle(tx, request.id, tenantId, state, graph);
        }
      }

      if (action === 'reject') {
        await tx.requestStep.update({
          where: { id: stepId },
          data: { status: 'rejected', completedAt: new Date() },
        });
        if (request.workflowVersion.rejectionPolicy === 'reject_returns_to_previous_step') {
          const previous = await tx.requestStep.findFirst({
            where: { requestId: request.id, status: 'approved' },
            orderBy: { completedAt: 'desc' },
          });
          if (previous) {
            const state = request.engineState as unknown as EngineState;
            state.completed = state.completed.filter((id) => id !== previous.nodeId);
            state.delivered = state.delivered.filter(
              (key) => !key.startsWith(`${previous.nodeId}->`),
            );
            await tx.requestStep.update({
              where: { id: previous.id },
              data: { status: 'superseded' },
            });
            await this.activateNode(
              tx,
              request.id,
              tenantId,
              graph,
              previous.nodeId,
              state,
              request.payload as Record<string, unknown>,
              request.createdById,
            );
            await this.persistState(tx, request.id, state);
            await this.audit.record({
              tenantId,
              actorUserId: actor.userId,
              eventType: 'step.returned',
              entityType: 'request_step',
              entityId: stepId,
              after: { returnedToNode: previous.nodeId },
            });
          } else {
            await this.finalize(tx, request.id, tenantId, 'rejected');
          }
        } else {
          await this.finalize(tx, request.id, tenantId, 'rejected');
        }
      }

      return { requestId: request.id, onBehalfOfUserId };
    });

    await this.audit.record({
      tenantId,
      actorUserId: actor.userId,
      eventType: `step.${action}`,
      entityType: 'request_step',
      entityId: stepId,
      after: {
        requestId: outcome.requestId,
        comment: body.comment,
        toUserId: body.toUserId,
        onBehalfOfUserId: outcome.onBehalfOfUserId,
      },
      ip,
    });

    return this.describe(tenantId, outcome.requestId);
  }

  // ----------------------------------------------------------------- reads

  /** Full request snapshot: status, steps, actions, pending approvers. */
  async describe(tenantId: string, requestId: string) {
    const client = this.tenantPrisma.forTenant(tenantId);
    const request = await client.request.findUnique({
      where: { id: requestId },
      include: {
        workflowVersion: {
          select: { id: true, version: true, workflowId: true, rejectionPolicy: true, graph: true },
        },
        steps: {
          orderBy: { createdAt: 'asc' },
          include: { actions: { orderBy: { actedAt: 'asc' } } },
        },
      },
    });
    if (!request) throw new NotFoundException('Request not found');

    // Context for the "Why am I seeing this?" line: rule + workflow names,
    // creator identity, and where in the graph each step sits.
    const [pendingApprovers, workflow, matchedRuleVersion, creator] = await Promise.all([
      this.pendingApprovers(tenantId, request),
      client.workflow.findUnique({
        where: { id: request.workflowVersion.workflowId },
        select: { name: true },
      }),
      request.matchedRuleVersionId
        ? client.ruleVersion.findUnique({
            where: { id: request.matchedRuleVersionId },
            select: { version: true, rule: { select: { id: true, name: true } } },
          })
        : null,
      client.user.findUnique({
        where: { id: request.createdById },
        select: { id: true, name: true, email: true },
      }),
    ]);

    // Requests created through the machine API have an API key as creator.
    const creatorKey = creator
      ? null
      : await client.apiKey.findUnique({
          where: { id: request.createdById },
          select: { id: true, name: true },
        });
    const createdBy =
      creator ??
      (creatorKey
        ? { id: creatorKey.id, name: `${creatorKey.name} (API key)`, email: null }
        : null);

    // Resolve actor names for the timeline in one sweep.
    const actorIds = [
      ...new Set(
        request.steps.flatMap((step) =>
          step.actions.flatMap((action) =>
            [action.actorUserId, action.targetUserId, action.onBehalfOfUserId].filter(
              (id): id is string => id !== null,
            ),
          ),
        ),
      ),
    ];
    const actors =
      actorIds.length > 0
        ? await client.user.findMany({
            where: { id: { in: actorIds } },
            select: { id: true, name: true },
          })
        : [];
    const actorName = new Map(actors.map((user) => [user.id, user.name]));

    const { workflowVersion, engineState, initialResponse, steps, ...rest } = request;
    void engineState;
    void initialResponse;
    const shapedSteps = steps.map((step) => ({
      ...step,
      actions: step.actions.map((action) => ({
        ...action,
        actorName: actorName.get(action.actorUserId) ?? null,
        targetName: action.targetUserId ? (actorName.get(action.targetUserId) ?? null) : null,
        onBehalfOfName: action.onBehalfOfUserId
          ? (actorName.get(action.onBehalfOfUserId) ?? null)
          : null,
      })),
    }));
    return {
      ...rest,
      steps: shapedSteps,
      workflowVersion: {
        id: workflowVersion.id,
        version: workflowVersion.version,
        workflowId: workflowVersion.workflowId,
        workflowName: workflow?.name ?? null,
        rejectionPolicy: workflowVersion.rejectionPolicy,
        graph: workflowVersion.graph,
      },
      matchedRule: matchedRuleVersion
        ? {
            ruleId: matchedRuleVersion.rule.id,
            name: matchedRuleVersion.rule.name,
            version: matchedRuleVersion.version,
          }
        : null,
      createdBy,
      pendingApprovers,
    };
  }

  async pendingApprovers(
    tenantId: string,
    request: {
      id: string;
      createdById: string;
      steps: {
        id: string;
        nodeId: string;
        status: string;
        assignedRoleId: string;
        dueAt: Date | null;
      }[];
    },
  ): Promise<PendingApprover[]> {
    const client = this.tenantPrisma.forTenant(tenantId);
    const pending = request.steps.filter((step) => step.status === 'pending');
    const result: PendingApprover[] = [];
    for (const step of pending) {
      const [role, memberships] = await Promise.all([
        client.role.findUnique({ where: { id: step.assignedRoleId } }),
        client.userRole.findMany({
          where: { roleId: step.assignedRoleId, user: { status: 'active' } },
          select: { user: { select: { id: true, name: true } } },
        }),
      ]);
      result.push({
        stepId: step.id,
        nodeId: step.nodeId,
        roleId: step.assignedRoleId,
        roleName: role?.name ?? 'unknown',
        dueAt: step.dueAt?.toISOString() ?? null,
        eligibleUsers: memberships
          .map((m) => m.user)
          .filter((user) => user.id !== request.createdById),
      });
    }
    return result;
  }
}
