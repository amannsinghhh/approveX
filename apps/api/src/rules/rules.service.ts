import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { ConditionNode, ValidationResult } from '@approvex/shared';
import { isCatchAllAst, validateConditionAst, validateScoringSpec } from '@approvex/shared';
import { Prisma } from '@prisma/client'; // value import: Prisma.DbNull
import type { RuleType } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { RuleCacheService } from './rule-cache.service';
import type { CreateRuleDto, ListRulesQuery, UpdateRuleDto, UpsertDraftDto } from './rules.schemas';

const VERSION_SELECT = {
  id: true,
  version: true,
  ruleType: true,
  conditionAst: true,
  scoringSpec: true,
  priority: true,
  effectiveFrom: true,
  effectiveTo: true,
  publishedAt: true,
  publishedById: true,
  createdAt: true,
} as const;

/** The one payload a version carries, keyed by its type (mirrors the DB CHECK). */
interface VersionPayload {
  ruleType: RuleType;
  conditionAst?: unknown;
  scoringSpec?: unknown;
}

@Injectable()
export class RulesService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly ruleCache: RuleCacheService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Validates the version's payload against its type, throwing 400 with
   * per-node issues when the condition AST or scoring spec is malformed.
   */
  private assertValidPayload(payload: VersionPayload): void {
    const scoring = payload.ruleType === 'scoring';
    const result: ValidationResult = scoring
      ? validateScoringSpec(payload.scoringSpec)
      : validateConditionAst(payload.conditionAst);
    if (!result.valid) {
      throw new BadRequestException({
        message: scoring ? 'Invalid scoring spec' : 'Invalid condition AST',
        issues: result.issues,
      });
    }
  }

  /** The columns to write for a version, with the unused payload column nulled. */
  private payloadColumns(payload: VersionPayload) {
    return payload.ruleType === 'scoring'
      ? {
          ruleType: 'scoring' as const,
          conditionAst: Prisma.DbNull,
          scoringSpec: payload.scoringSpec as Prisma.InputJsonValue,
        }
      : {
          ruleType: 'condition_tree' as const,
          conditionAst: payload.conditionAst as Prisma.InputJsonValue,
          scoringSpec: Prisma.DbNull,
        };
  }

  async create(tenantId: string, dto: CreateRuleDto) {
    this.assertValidPayload(dto);
    const client = this.tenantPrisma.forTenant(tenantId);

    const existing = await client.rule.findFirst({ where: { name: dto.name } });
    if (existing) throw new ConflictException('A rule with this name already exists');

    const rule = await client.rule.create({
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
            ...this.payloadColumns(dto),
            priority: dto.priority,
            effectiveFrom: dto.effectiveFrom,
            effectiveTo: dto.effectiveTo,
          },
        },
      },
      include: { versions: { select: VERSION_SELECT } },
    });
    return this.shape(rule);
  }

  async list(tenantId: string, query: ListRulesQuery) {
    const client = this.tenantPrisma.forTenant(tenantId);
    const where = {
      ...(query.context ? { context: query.context } : {}),
      ...(query.status ? { status: query.status } : {}),
    };
    const [items, total] = await Promise.all([
      client.rule.findMany({
        where,
        orderBy: { createdAt: 'asc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { versions: { orderBy: { version: 'desc' }, take: 1, select: VERSION_SELECT } },
      }),
      client.rule.count({ where }),
    ]);
    return {
      items: items.map((rule) => this.shape(rule)),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  /**
   * Fallback health per context (B.3 #15): every context should have exactly
   * one published catch-all (match-all) rule as an explicit safety net, so
   * "no rule matched" is a designed default rather than a silent gap. Reports
   * each context with published rules and whether it has a catch-all — the
   * Rule Builder uses this to nudge tenants to add one.
   */
  async contextsHealth(tenantId: string) {
    const client = this.tenantPrisma.forTenant(tenantId);
    const rules = await client.rule.findMany({
      where: { status: 'published' },
      select: {
        id: true,
        name: true,
        context: true,
        versions: {
          where: { publishedAt: { not: null } },
          orderBy: { version: 'desc' },
          take: 1,
          select: { ruleType: true, conditionAst: true },
        },
      },
    });

    const byContext = new Map<
      string,
      { context: string; publishedRules: number; hasFallback: boolean; fallbackRuleId: string | null }
    >();
    for (const rule of rules) {
      const entry =
        byContext.get(rule.context) ??
        { context: rule.context, publishedRules: 0, hasFallback: false, fallbackRuleId: null };
      entry.publishedRules += 1;
      // Only a condition tree can be the always-match fallback; a scoring rule
      // always has a threshold it can fail.
      const head = rule.versions[0];
      const ast =
        head?.ruleType === 'condition_tree'
          ? (head.conditionAst as unknown as ConditionNode | null)
          : null;
      if (ast && isCatchAllAst(ast)) {
        entry.hasFallback = true;
        entry.fallbackRuleId = rule.id;
      }
      byContext.set(rule.context, entry);
    }

    return { contexts: [...byContext.values()].sort((a, b) => a.context.localeCompare(b.context)) };
  }

  async get(tenantId: string, ruleId: string) {
    const rule = await this.tenantPrisma.forTenant(tenantId).rule.findUnique({
      where: { id: ruleId },
      include: { versions: { orderBy: { version: 'desc' }, select: VERSION_SELECT } },
    });
    if (!rule) throw new NotFoundException('Rule not found');
    return { ...this.shape(rule), versions: rule.versions };
  }

  async listVersions(tenantId: string, ruleId: string) {
    const rule = await this.tenantPrisma.forTenant(tenantId).rule.findUnique({
      where: { id: ruleId },
      include: { versions: { orderBy: { version: 'desc' }, select: VERSION_SELECT } },
    });
    if (!rule) throw new NotFoundException('Rule not found');
    return { items: rule.versions };
  }

  async updateMetadata(tenantId: string, ruleId: string, dto: UpdateRuleDto) {
    const client = this.tenantPrisma.forTenant(tenantId);
    const rule = await client.rule.findUnique({ where: { id: ruleId } });
    if (!rule) throw new NotFoundException('Rule not found');

    if (dto.name && dto.name !== rule.name) {
      const clash = await client.rule.findFirst({ where: { name: dto.name, id: { not: ruleId } } });
      if (clash) throw new ConflictException('A rule with this name already exists');
    }

    const updated = await client.rule.update({
      where: { id: ruleId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
      },
      include: { versions: { orderBy: { version: 'desc' }, take: 1, select: VERSION_SELECT } },
    });
    return this.shape(updated);
  }

  /**
   * Creates or updates the draft head. If the latest version is published,
   * a new draft version (n+1) is created — published versions are immutable.
   */
  async upsertDraft(tenantId: string, ruleId: string, dto: UpsertDraftDto) {
    this.assertValidPayload(dto);
    const client = this.tenantPrisma.forTenant(tenantId);

    const rule = await client.rule.findUnique({
      where: { id: ruleId },
      include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
    });
    if (!rule) throw new NotFoundException('Rule not found');
    if (rule.status === 'archived') throw new ConflictException('Archived rules cannot be edited');

    const head = rule.versions[0];
    const data = {
      ...this.payloadColumns(dto),
      priority: dto.priority,
      effectiveFrom: dto.effectiveFrom ?? null,
      effectiveTo: dto.effectiveTo ?? null,
    };

    const version =
      head && head.publishedAt === null
        ? await client.ruleVersion.update({ where: { id: head.id }, data, select: VERSION_SELECT })
        : await client.ruleVersion.create({
            data: { ...data, tenantId, ruleId, version: (head?.version ?? 0) + 1 },
            select: VERSION_SELECT,
          });

    return version;
  }

  /** Publishes the draft head; running evaluations pick it up via cache invalidation. */
  async publish(tenantId: string, actorUserId: string, ruleId: string, ip?: string) {
    const client = this.tenantPrisma.forTenant(tenantId);
    const rule = await client.rule.findUnique({
      where: { id: ruleId },
      include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
    });
    if (!rule) throw new NotFoundException('Rule not found');
    if (rule.status === 'archived')
      throw new ConflictException('Archived rules cannot be published');

    const head = rule.versions[0];
    if (!head) throw new ConflictException('Rule has no versions');
    if (head.publishedAt !== null) {
      throw new ConflictException(
        `Version ${head.version} is already published — edit the draft first`,
      );
    }
    // Re-validate at publish time: validation rules may have tightened since drafting.
    this.assertValidPayload(head);

    const published = await this.tenantPrisma.transactionForTenant(tenantId, async (tx) => {
      const version = await tx.ruleVersion.update({
        where: { id: head.id },
        data: { publishedAt: new Date(), publishedById: actorUserId },
        select: VERSION_SELECT,
      });
      await tx.rule.update({
        where: { id: ruleId },
        data: { status: 'published', currentVersion: head.version },
      });
      return version;
    });

    await this.ruleCache.invalidateRuleSet(tenantId, rule.context);
    await this.audit.record({
      tenantId,
      actorUserId,
      eventType: 'rule.published',
      entityType: 'rule',
      entityId: ruleId,
      after: { version: published.version, priority: published.priority, context: rule.context },
      ip,
    });
    return published;
  }

  async archive(tenantId: string, actorUserId: string, ruleId: string) {
    const client = this.tenantPrisma.forTenant(tenantId);
    const rule = await client.rule.findUnique({ where: { id: ruleId } });
    if (!rule) throw new NotFoundException('Rule not found');
    if (rule.status === 'archived') throw new ConflictException('Rule is already archived');

    const updated = await client.rule.update({
      where: { id: ruleId },
      data: { status: 'archived' },
    });
    await this.ruleCache.invalidateRuleSet(tenantId, rule.context);
    await this.audit.record({
      tenantId,
      actorUserId,
      eventType: 'rule.archived',
      entityType: 'rule',
      entityId: ruleId,
      before: { status: rule.status },
      after: { status: 'archived' },
    });
    return { id: updated.id, status: updated.status };
  }

  /** Hard delete is only possible while nothing was ever published. */
  async remove(tenantId: string, ruleId: string): Promise<{ id: string }> {
    const client = this.tenantPrisma.forTenant(tenantId);
    const rule = await client.rule.findUnique({
      where: { id: ruleId },
      include: { versions: { where: { publishedAt: { not: null } }, take: 1 } },
    });
    if (!rule) throw new NotFoundException('Rule not found');
    if (rule.versions.length > 0) {
      throw new ConflictException(
        'Rules with published versions cannot be deleted — archive instead',
      );
    }
    await client.rule.delete({ where: { id: ruleId } });
    return { id: ruleId };
  }

  private shape(rule: {
    id: string;
    name: string;
    description: string | null;
    context: string;
    status: string;
    currentVersion: number;
    createdAt: Date;
    updatedAt: Date;
    versions: { [K in keyof typeof VERSION_SELECT]?: unknown }[];
  }) {
    const { versions, ...rest } = rule;
    return { ...rest, latestVersion: versions[0] ?? null };
  }
}
