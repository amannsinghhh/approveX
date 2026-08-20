import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { DecisionTableDefinition } from '@approvex/shared';
import { evaluateDecisionTable, validateDecisionTable } from '@approvex/shared';
import type { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { RuleCacheService } from '../rules/rule-cache.service';
import type {
  CreateDecisionTableDto,
  ListTablesQuery,
  TestDecisionTableDto,
  UpdateDecisionTableDto,
  UpsertTableDraftDto,
} from './decision-tables.schemas';

const VERSION_SELECT = {
  id: true,
  version: true,
  columns: true,
  rows: true,
  hitPolicy: true,
  publishedAt: true,
  publishedById: true,
  createdAt: true,
} as const;

type Definition = Pick<CreateDecisionTableDto, 'columns' | 'rows' | 'hitPolicy'>;

@Injectable()
export class DecisionTablesService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly ruleCache: RuleCacheService,
    private readonly audit: AuditService,
  ) {}

  private async assertValidDefinition(tenantId: string, definition: Definition): Promise<void> {
    const fieldSchema = await this.ruleCache.getFieldSchema(tenantId);
    const result = validateDecisionTable(definition, fieldSchema);
    if (!result.valid) {
      throw new BadRequestException({
        message: 'Invalid decision table',
        issues: result.issues,
      });
    }
  }

  async create(tenantId: string, dto: CreateDecisionTableDto) {
    await this.assertValidDefinition(tenantId, dto);
    const client = this.tenantPrisma.forTenant(tenantId);

    const existing = await client.decisionTable.findFirst({ where: { name: dto.name } });
    if (existing) throw new ConflictException('A decision table with this name already exists');

    const table = await client.decisionTable.create({
      data: {
        tenantId,
        name: dto.name,
        description: dto.description,
        context: dto.context,
        status: 'draft',
        versions: {
          create: {
            tenantId,
            version: 1,
            columns: dto.columns as unknown as Prisma.InputJsonValue,
            rows: dto.rows as unknown as Prisma.InputJsonValue,
            hitPolicy: dto.hitPolicy,
          },
        },
      },
      include: { versions: { select: VERSION_SELECT } },
    });
    return this.shape(table);
  }

  async list(tenantId: string, query: ListTablesQuery) {
    const client = this.tenantPrisma.forTenant(tenantId);
    const where = {
      ...(query.context ? { context: query.context } : {}),
      ...(query.status ? { status: query.status } : {}),
    };
    const [items, total] = await Promise.all([
      client.decisionTable.findMany({
        where,
        orderBy: { createdAt: 'asc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { versions: { orderBy: { version: 'desc' }, take: 1, select: VERSION_SELECT } },
      }),
      client.decisionTable.count({ where }),
    ]);
    return {
      items: items.map((table) => this.shape(table)),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async get(tenantId: string, tableId: string) {
    const table = await this.tenantPrisma.forTenant(tenantId).decisionTable.findUnique({
      where: { id: tableId },
      include: { versions: { orderBy: { version: 'desc' }, select: VERSION_SELECT } },
    });
    if (!table) throw new NotFoundException('Decision table not found');
    return { ...this.shape(table), versions: table.versions };
  }

  async updateMetadata(tenantId: string, tableId: string, dto: UpdateDecisionTableDto) {
    const client = this.tenantPrisma.forTenant(tenantId);
    const table = await client.decisionTable.findUnique({ where: { id: tableId } });
    if (!table) throw new NotFoundException('Decision table not found');

    if (dto.name && dto.name !== table.name) {
      const clash = await client.decisionTable.findFirst({
        where: { name: dto.name, id: { not: tableId } },
      });
      if (clash) throw new ConflictException('A decision table with this name already exists');
    }

    const updated = await client.decisionTable.update({
      where: { id: tableId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
      },
      include: { versions: { orderBy: { version: 'desc' }, take: 1, select: VERSION_SELECT } },
    });
    return this.shape(updated);
  }

  async upsertDraft(tenantId: string, tableId: string, dto: UpsertTableDraftDto) {
    await this.assertValidDefinition(tenantId, dto);
    const client = this.tenantPrisma.forTenant(tenantId);

    const table = await client.decisionTable.findUnique({
      where: { id: tableId },
      include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
    });
    if (!table) throw new NotFoundException('Decision table not found');
    if (table.status === 'archived') {
      throw new ConflictException('Archived decision tables cannot be edited');
    }

    const head = table.versions[0];
    const data = {
      columns: dto.columns as unknown as Prisma.InputJsonValue,
      rows: dto.rows as unknown as Prisma.InputJsonValue,
      hitPolicy: dto.hitPolicy,
    };

    return head && head.publishedAt === null
      ? client.decisionTableVersion.update({
          where: { id: head.id },
          data,
          select: VERSION_SELECT,
        })
      : client.decisionTableVersion.create({
          data: { ...data, tenantId, tableId, version: (head?.version ?? 0) + 1 },
          select: VERSION_SELECT,
        });
  }

  async publish(tenantId: string, actorUserId: string, tableId: string, ip?: string) {
    const client = this.tenantPrisma.forTenant(tenantId);
    const table = await client.decisionTable.findUnique({
      where: { id: tableId },
      include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
    });
    if (!table) throw new NotFoundException('Decision table not found');
    if (table.status === 'archived') {
      throw new ConflictException('Archived decision tables cannot be published');
    }

    const head = table.versions[0];
    if (!head) throw new ConflictException('Decision table has no versions');
    if (head.publishedAt !== null) {
      throw new ConflictException(
        `Version ${head.version} is already published — edit the draft first`,
      );
    }
    await this.assertValidDefinition(tenantId, {
      columns: head.columns as never,
      rows: head.rows as never,
      hitPolicy: head.hitPolicy,
    });

    const published = await this.tenantPrisma.transactionForTenant(tenantId, async (tx) => {
      const version = await tx.decisionTableVersion.update({
        where: { id: head.id },
        data: { publishedAt: new Date(), publishedById: actorUserId },
        select: VERSION_SELECT,
      });
      await tx.decisionTable.update({
        where: { id: tableId },
        data: { status: 'published', currentVersion: head.version },
      });
      return version;
    });

    await this.audit.record({
      tenantId,
      actorUserId,
      eventType: 'decision_table.published',
      entityType: 'decision_table',
      entityId: tableId,
      after: { version: published.version, context: table.context },
      ip,
    });
    return published;
  }

  async archive(tenantId: string, actorUserId: string, tableId: string) {
    const client = this.tenantPrisma.forTenant(tenantId);
    const table = await client.decisionTable.findUnique({ where: { id: tableId } });
    if (!table) throw new NotFoundException('Decision table not found');
    if (table.status === 'archived') throw new ConflictException('Already archived');

    const updated = await client.decisionTable.update({
      where: { id: tableId },
      data: { status: 'archived' },
    });
    await this.audit.record({
      tenantId,
      actorUserId,
      eventType: 'decision_table.archived',
      entityType: 'decision_table',
      entityId: tableId,
      before: { status: table.status },
      after: { status: 'archived' },
    });
    return { id: updated.id, status: updated.status };
  }

  async remove(tenantId: string, tableId: string): Promise<{ id: string }> {
    const client = this.tenantPrisma.forTenant(tenantId);
    const table = await client.decisionTable.findUnique({
      where: { id: tableId },
      include: { versions: { where: { publishedAt: { not: null } }, take: 1 } },
    });
    if (!table) throw new NotFoundException('Decision table not found');
    if (table.versions.length > 0) {
      throw new ConflictException(
        'Decision tables with published versions cannot be deleted — archive instead',
      );
    }
    await client.decisionTable.delete({ where: { id: tableId } });
    return { id: tableId };
  }

  /** Dry-run of the head (latest) version. No side effects. */
  async test(tenantId: string, tableId: string, dto: TestDecisionTableDto) {
    const client = this.tenantPrisma.forTenant(tenantId);
    const table = await client.decisionTable.findUnique({
      where: { id: tableId },
      include: { versions: { orderBy: { version: 'desc' }, take: 1, select: VERSION_SELECT } },
    });
    if (!table) throw new NotFoundException('Decision table not found');
    const head = table.versions[0];
    if (!head) throw new ConflictException('Decision table has no versions');

    const [fieldSchema, managedLists] = await Promise.all([
      this.ruleCache.getFieldSchema(tenantId),
      this.ruleCache.getManagedLists(tenantId),
    ]);
    const definition: DecisionTableDefinition = {
      columns: head.columns as never,
      rows: head.rows as never,
      hitPolicy: head.hitPolicy,
    };
    return {
      tableId,
      version: head.version,
      ...evaluateDecisionTable(definition, dto.data, { fieldSchema, managedLists }),
    };
  }

  private shape(table: {
    id: string;
    name: string;
    description: string | null;
    context: string;
    status: string;
    currentVersion: number;
    createdAt: Date;
    updatedAt: Date;
    versions: unknown[];
  }) {
    const { versions, ...rest } = table;
    return { ...rest, latestVersion: versions[0] ?? null };
  }
}
