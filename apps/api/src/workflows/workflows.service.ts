import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { RejectionPolicy, WorkflowGraph } from '../../../../shared/src/index';
import { validateWorkflowGraph } from '../../../../shared/src/index';
import type { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import type {
  CreateWorkflowDto,
  ListWorkflowsQuery,
  UpdateWorkflowDto,
  UpsertWorkflowDraftDto,
} from './workflows.schemas';

const VERSION_SELECT = {
  id: true,
  version: true,
  graph: true,
  rejectionPolicy: true,
  publishedAt: true,
  publishedById: true,
  createdAt: true,
} as const;

@Injectable()
export class WorkflowsService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Validates graph structure + role references within the tenant. */
  async validate(
    tenantId: string,
    graph: unknown,
    rejectionPolicy: RejectionPolicy,
  ): Promise<{ valid: boolean; issues: { path: string; message: string }[] }> {
    const roles = await this.tenantPrisma
      .forTenant(tenantId)
      .role.findMany({ select: { id: true } });
    return validateWorkflowGraph(graph, {
      roleIds: new Set(roles.map((role) => role.id)),
      rejectionPolicy,
    });
  }

  private async assertValid(
    tenantId: string,
    graph: unknown,
    rejectionPolicy: RejectionPolicy,
  ): Promise<void> {
    const result = await this.validate(tenantId, graph, rejectionPolicy);
    if (!result.valid) {
      throw new BadRequestException({ message: 'Invalid workflow graph', issues: result.issues });
    }
  }

  async create(tenantId: string, dto: CreateWorkflowDto) {
    await this.assertValid(tenantId, dto.graph, dto.rejectionPolicy);
    const client = this.tenantPrisma.forTenant(tenantId);

    const existing = await client.workflow.findFirst({ where: { name: dto.name } });
    if (existing) throw new ConflictException('A workflow with this name already exists');

    const workflow = await client.workflow.create({
      data: {
        tenantId,
        name: dto.name,
        description: dto.description,
        status: 'draft',
        versions: {
          create: {
            tenantId,
            version: 1,
            graph: dto.graph as Prisma.InputJsonValue,
            rejectionPolicy: dto.rejectionPolicy,
          },
        },
      },
      include: { versions: { select: VERSION_SELECT } },
    });
    return this.shape(workflow);
  }

  async list(tenantId: string, query: ListWorkflowsQuery) {
    const client = this.tenantPrisma.forTenant(tenantId);
    const where = query.status ? { status: query.status } : {};
    const [items, total] = await Promise.all([
      client.workflow.findMany({
        where,
        orderBy: { createdAt: 'asc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { versions: { orderBy: { version: 'desc' }, take: 1, select: VERSION_SELECT } },
      }),
      client.workflow.count({ where }),
    ]);
    return {
      items: items.map((workflow) => this.shape(workflow)),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async get(tenantId: string, workflowId: string) {
    const workflow = await this.tenantPrisma.forTenant(tenantId).workflow.findUnique({
      where: { id: workflowId },
      include: { versions: { orderBy: { version: 'desc' }, select: VERSION_SELECT } },
    });
    if (!workflow) throw new NotFoundException('Workflow not found');
    return { ...this.shape(workflow), versions: workflow.versions };
  }

  async updateMetadata(tenantId: string, workflowId: string, dto: UpdateWorkflowDto) {
    const client = this.tenantPrisma.forTenant(tenantId);
    const workflow = await client.workflow.findUnique({ where: { id: workflowId } });
    if (!workflow) throw new NotFoundException('Workflow not found');

    if (dto.name && dto.name !== workflow.name) {
      const clash = await client.workflow.findFirst({
        where: { name: dto.name, id: { not: workflowId } },
      });
      if (clash) throw new ConflictException('A workflow with this name already exists');
    }

    const updated = await client.workflow.update({
      where: { id: workflowId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
      },
      include: { versions: { orderBy: { version: 'desc' }, take: 1, select: VERSION_SELECT } },
    });
    return this.shape(updated);
  }

  async upsertDraft(tenantId: string, workflowId: string, dto: UpsertWorkflowDraftDto) {
    await this.assertValid(tenantId, dto.graph, dto.rejectionPolicy);
    const client = this.tenantPrisma.forTenant(tenantId);

    const workflow = await client.workflow.findUnique({
      where: { id: workflowId },
      include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
    });
    if (!workflow) throw new NotFoundException('Workflow not found');
    if (workflow.status === 'archived') {
      throw new ConflictException('Archived workflows cannot be edited');
    }

    const head = workflow.versions[0];
    const data = {
      graph: dto.graph as Prisma.InputJsonValue,
      rejectionPolicy: dto.rejectionPolicy,
    };

    return head && head.publishedAt === null
      ? client.workflowVersion.update({ where: { id: head.id }, data, select: VERSION_SELECT })
      : client.workflowVersion.create({
          data: { ...data, tenantId, workflowId, version: (head?.version ?? 0) + 1 },
          select: VERSION_SELECT,
        });
  }

  async publish(tenantId: string, actorUserId: string, workflowId: string, ip?: string) {
    const client = this.tenantPrisma.forTenant(tenantId);
    const workflow = await client.workflow.findUnique({
      where: { id: workflowId },
      include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
    });
    if (!workflow) throw new NotFoundException('Workflow not found');
    if (workflow.status === 'archived') {
      throw new ConflictException('Archived workflows cannot be published');
    }

    const head = workflow.versions[0];
    if (!head) throw new ConflictException('Workflow has no versions');
    if (head.publishedAt !== null) {
      throw new ConflictException(
        `Version ${head.version} is already published — edit the draft first`,
      );
    }
    // Roles may have been deleted since drafting: re-validate at publish time.
    await this.assertValid(tenantId, head.graph, head.rejectionPolicy);

    const published = await this.tenantPrisma.transactionForTenant(tenantId, async (tx) => {
      const version = await tx.workflowVersion.update({
        where: { id: head.id },
        data: { publishedAt: new Date(), publishedById: actorUserId },
        select: VERSION_SELECT,
      });
      await tx.workflow.update({
        where: { id: workflowId },
        data: { status: 'published', currentVersion: head.version },
      });
      return version;
    });

    await this.audit.record({
      tenantId,
      actorUserId,
      eventType: 'workflow.published',
      entityType: 'workflow',
      entityId: workflowId,
      after: { version: published.version },
      ip,
    });
    return published;
  }

  async archive(tenantId: string, actorUserId: string, workflowId: string) {
    const client = this.tenantPrisma.forTenant(tenantId);
    const workflow = await client.workflow.findUnique({ where: { id: workflowId } });
    if (!workflow) throw new NotFoundException('Workflow not found');
    if (workflow.status === 'archived') throw new ConflictException('Already archived');

    const updated = await client.workflow.update({
      where: { id: workflowId },
      data: { status: 'archived' },
    });
    await this.audit.record({
      tenantId,
      actorUserId,
      eventType: 'workflow.archived',
      entityType: 'workflow',
      entityId: workflowId,
      before: { status: workflow.status },
      after: { status: 'archived' },
    });
    return { id: updated.id, status: updated.status };
  }

  async remove(tenantId: string, workflowId: string): Promise<{ id: string }> {
    const client = this.tenantPrisma.forTenant(tenantId);
    const workflow = await client.workflow.findUnique({
      where: { id: workflowId },
      include: { versions: { where: { publishedAt: { not: null } }, take: 1 } },
    });
    if (!workflow) throw new NotFoundException('Workflow not found');
    if (workflow.versions.length > 0) {
      throw new ConflictException(
        'Workflows with published versions cannot be deleted — archive instead',
      );
    }
    await client.workflow.delete({ where: { id: workflowId } });
    return { id: workflowId };
  }

  /** Binds a rule's head version to a workflow; instantiation resolves + pins. */
  async bindRule(tenantId: string, ruleId: string, workflowId: string) {
    const client = this.tenantPrisma.forTenant(tenantId);
    const [rule, workflow] = await Promise.all([
      client.rule.findUnique({
        where: { id: ruleId },
        include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
      }),
      client.workflow.findUnique({ where: { id: workflowId } }),
    ]);
    if (!rule) throw new NotFoundException('Rule not found');
    if (!workflow) throw new NotFoundException('Workflow not found');
    const head = rule.versions[0];
    if (!head) throw new ConflictException('Rule has no versions');

    const binding = await client.ruleWorkflowBinding.upsert({
      where: { ruleVersionId: head.id },
      create: { tenantId, ruleVersionId: head.id, workflowId },
      update: { workflowId },
    });
    return { id: binding.id, ruleVersionId: head.id, workflowId, ruleVersion: head.version };
  }

  private shape(workflow: {
    id: string;
    name: string;
    description: string | null;
    status: string;
    currentVersion: number;
    createdAt: Date;
    updatedAt: Date;
    versions: unknown[];
  }) {
    const { versions, ...rest } = workflow;
    return { ...rest, latestVersion: versions[0] ?? null };
  }
}

export type { WorkflowGraph };
