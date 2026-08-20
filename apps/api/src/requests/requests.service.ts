import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../common/auth.types';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { OutboxService } from '../webhooks/outbox.service';
import { RequestEngineService } from './request-engine.service';
import type { CreateRequestDto, ListRequestsQuery } from './requests.schemas';

@Injectable()
export class RequestsService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly engine: RequestEngineService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  /** Idempotency: same key + tenant ⇒ the original response, never a duplicate. */
  async findByIdempotencyKey(tenantId: string, key: string): Promise<unknown | null> {
    const existing = await this.tenantPrisma.forTenant(tenantId).request.findUnique({
      where: { tenantId_idempotencyKey: { tenantId, idempotencyKey: key } },
      select: { initialResponse: true },
    });
    return existing?.initialResponse ?? null;
  }

  async storeInitialResponse(
    tenantId: string,
    requestId: string,
    response: unknown,
  ): Promise<void> {
    await this.tenantPrisma.forTenant(tenantId).request.update({
      where: { id: requestId },
      data: { initialResponse: response as Prisma.InputJsonValue },
    });
  }

  /** POST /requests — skip rule matching, name the workflow explicitly. */
  async createDirect(
    tenantId: string,
    actorUserId: string,
    dto: CreateRequestDto,
    idempotencyKey?: string,
    ip?: string,
  ) {
    if (idempotencyKey) {
      const replay = await this.findByIdempotencyKey(tenantId, idempotencyKey);
      if (replay) return replay;
    }

    const client = this.tenantPrisma.forTenant(tenantId);
    const workflow = await client.workflow.findUnique({
      where: { id: dto.workflowId },
      include: {
        versions: {
          where: { publishedAt: { not: null } },
          orderBy: { version: 'desc' },
          take: 1,
        },
      },
    });
    if (!workflow) throw new NotFoundException('Workflow not found');
    const version = workflow.versions[0];
    if (workflow.status !== 'published' || !version) {
      throw new UnprocessableEntityException('Workflow has no published version');
    }

    let described;
    try {
      described = await this.engine.instantiate({
        tenantId,
        actorUserId,
        workflowVersion: version,
        payload: dto.payload,
        context: dto.context,
        title: dto.title,
        externalRef: dto.externalRef,
        idempotencyKey,
        ip,
      });
    } catch (err) {
      // Unique-violation race on the idempotency key: another call won — replay it.
      if (
        idempotencyKey &&
        typeof err === 'object' &&
        err !== null &&
        (err as { code?: string }).code === 'P2002'
      ) {
        const replay = await this.findByIdempotencyKey(tenantId, idempotencyKey);
        if (replay) return replay;
      }
      throw err;
    }

    const response = {
      requestId: described.id,
      status: described.status,
      pendingApprovers: described.pendingApprovers,
    };
    if (idempotencyKey) await this.storeInitialResponse(tenantId, described.id, response);
    return response;
  }

  async list(tenantId: string, query: ListRequestsQuery) {
    const client = this.tenantPrisma.forTenant(tenantId);
    const where = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.context ? { context: query.context } : {}),
    };
    const [items, total] = await Promise.all([
      client.request.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true,
          title: true,
          externalRef: true,
          context: true,
          status: true,
          createdById: true,
          createdAt: true,
          completedAt: true,
          steps: {
            where: { status: 'pending' },
            select: { id: true, nodeId: true, assignedRoleId: true, dueAt: true },
          },
        },
      }),
      client.request.count({ where }),
    ]);
    return {
      items: items.map(({ steps, ...request }) => ({ ...request, pendingSteps: steps })),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async get(tenantId: string, requestId: string) {
    return this.engine.describe(tenantId, requestId);
  }

  async cancel(tenantId: string, actor: AuthUser, requestId: string, ip?: string) {
    await this.tenantPrisma.transactionForTenant(tenantId, async (tx) => {
      await tx.$queryRaw`SELECT id FROM requests WHERE id = ${requestId}::uuid FOR UPDATE`;
      const request = await tx.request.findUnique({ where: { id: requestId } });
      if (!request) throw new NotFoundException('Request not found');
      if (request.status !== 'pending') {
        throw new ConflictException(`Request is already ${request.status}`);
      }
      const isCreator = request.createdById === actor.userId;
      const isAdmin = actor.permissions?.includes('member:manage') ?? false;
      if (!isCreator && !isAdmin) {
        throw new ForbiddenException('Only the requester or an admin can cancel a request');
      }
      await tx.request.update({
        where: { id: requestId },
        data: { status: 'cancelled', completedAt: new Date() },
      });
      await tx.requestStep.updateMany({
        where: { requestId, status: 'pending' },
        data: { status: 'cancelled', completedAt: new Date() },
      });
      await this.outbox.enqueueForRequest(tx, tenantId, 'request.cancelled', requestId);
    });

    await this.audit.record({
      tenantId,
      actorUserId: actor.userId,
      eventType: 'request.cancelled',
      entityType: 'request',
      entityId: requestId,
      ip,
    });
    return this.engine.describe(tenantId, requestId);
  }

  /** Pending steps the current user can act on (spec §6 resolution order). */
  async inbox(tenantId: string, userId: string) {
    const client = this.tenantPrisma.forTenant(tenantId);

    const [myRoles, myDelegations] = await Promise.all([
      client.userRole.findMany({ where: { userId }, select: { roleId: true } }),
      client.delegation.findMany({
        where: { toUserId: userId, startsAt: { lte: new Date() }, endsAt: { gte: new Date() } },
        select: { fromUserId: true },
      }),
    ]);
    const roleIds = myRoles.map((membership) => membership.roleId);
    const delegatorIds = myDelegations.map((delegation) => delegation.fromUserId);

    const delegatorRoles =
      delegatorIds.length > 0
        ? await client.userRole.findMany({
            where: { userId: { in: delegatorIds } },
            select: { roleId: true },
          })
        : [];
    const actionableRoleIds = new Set([
      ...roleIds,
      ...delegatorRoles.map((membership) => membership.roleId),
    ]);

    const steps = await client.requestStep.findMany({
      where: {
        status: 'pending',
        OR: [
          { assignedRoleId: { in: [...actionableRoleIds] } },
          { actions: { some: { action: 'delegate', targetUserId: userId } } },
        ],
      },
      orderBy: { createdAt: 'asc' },
      include: {
        request: {
          select: {
            id: true,
            title: true,
            externalRef: true,
            context: true,
            payload: true,
            status: true,
            createdById: true,
            createdAt: true,
          },
        },
        actions: { select: { action: true, actorUserId: true, targetUserId: true } },
      },
    });

    // Maker-checker + acted filters happen here, not in SQL — modest volumes.
    const filtered = steps
      .filter((step) => step.request.createdById !== userId)
      .filter(
        (step) =>
          !step.actions.some(
            (action) =>
              action.actorUserId === userId &&
              (action.action === 'approve' || action.action === 'reject'),
          ),
      );

    const creatorIds = [...new Set(filtered.map((step) => step.request.createdById))];
    const creators =
      creatorIds.length > 0
        ? await client.user.findMany({
            where: { id: { in: creatorIds } },
            select: { id: true, name: true },
          })
        : [];
    const nameById = new Map(creators.map((user) => [user.id, user.name]));
    // Machine-created requests: the creator id is an API key, not a user.
    const unresolved = creatorIds.filter((id) => !nameById.has(id));
    if (unresolved.length > 0) {
      const keys = await client.apiKey.findMany({
        where: { id: { in: unresolved } },
        select: { id: true, name: true },
      });
      for (const key of keys) nameById.set(key.id, `${key.name} (API key)`);
    }

    const items = filtered.map(({ actions, request, ...step }) => {
      void actions;
      return {
        ...step,
        request: { ...request, createdByName: nameById.get(request.createdById) ?? null },
      };
    });

    return { items, total: items.length };
  }
}
