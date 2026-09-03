import { Injectable } from '@nestjs/common';
import type { ConditionNode, FieldMeta, FieldSchema, ScoringSpec } from '../../../../shared/src/index';
import { countComparisons, countScoringFactors } from '../../../../shared/src/index';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { RedisService } from '../redis/redis.service';

/** A published rule as evaluated: the current published version + tie-break metadata. */
interface PublishedRuleBase {
  ruleId: string;
  ruleName: string;
  versionId: string;
  version: number;
  priority: number;
  /**
   * Specificity for conflict resolution: comparison leaves for a condition
   * tree, factors for a scoring rule. More specific wins the tie.
   */
  conditionCount: number;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  ruleCreatedAt: string;
}

export type PublishedRule = PublishedRuleBase &
  (
    | { ruleType: 'condition_tree'; conditionAst: ConditionNode }
    | { ruleType: 'scoring'; scoringSpec: ScoringSpec }
  );

const TTL_SECONDS = 3600;
const ruleSetKey = (tenantId: string, context: string): string => `rules:${tenantId}:${context}`;
const fieldsKey = (tenantId: string): string => `fields:${tenantId}`;
const listsKey = (tenantId: string): string => `lists:${tenantId}`;

/** Named value lists for IN_LIST / NOT_IN_LIST, keyed by list name. */
export type ManagedListMap = Record<string, readonly string[]>;

/**
 * Per-tenant caches for the evaluation hot path (p95 < 50ms over 1,000 rules).
 * Redis down ⇒ silent fallback to Postgres. Invalidation on publish/archive
 * and field mutations; the TTL is the staleness backstop.
 */
@Injectable()
export class RuleCacheService {
  constructor(
    private readonly redis: RedisService,
    private readonly tenantPrisma: TenantPrismaService,
  ) {}

  async getPublishedRuleSet(tenantId: string, context: string): Promise<PublishedRule[]> {
    const key = ruleSetKey(tenantId, context);
    const cached = await this.redis.getJson<PublishedRule[]>(key);
    if (cached) return cached;

    const rules = await this.tenantPrisma.forTenant(tenantId).rule.findMany({
      where: { context, status: 'published' },
      select: {
        id: true,
        name: true,
        createdAt: true,
        versions: {
          where: { publishedAt: { not: null } },
          orderBy: { version: 'desc' },
          take: 1,
          select: {
            id: true,
            version: true,
            priority: true,
            ruleType: true,
            conditionAst: true,
            scoringSpec: true,
            effectiveFrom: true,
            effectiveTo: true,
          },
        },
      },
    });

    const ruleSet: PublishedRule[] = rules.flatMap((rule): PublishedRule[] => {
      const head = rule.versions[0];
      if (!head) return [];
      const base = {
        ruleId: rule.id,
        ruleName: rule.name,
        versionId: head.id,
        version: head.version,
        priority: head.priority,
        effectiveFrom: head.effectiveFrom?.toISOString() ?? null,
        effectiveTo: head.effectiveTo?.toISOString() ?? null,
        ruleCreatedAt: rule.createdAt.toISOString(),
      };
      if (head.ruleType === 'scoring') {
        const spec = head.scoringSpec as unknown as ScoringSpec;
        return [
          { ...base, ruleType: 'scoring' as const, scoringSpec: spec, conditionCount: countScoringFactors(spec) },
        ];
      }
      const ast = head.conditionAst as unknown as ConditionNode;
      return [
        { ...base, ruleType: 'condition_tree' as const, conditionAst: ast, conditionCount: countComparisons(ast) },
      ];
    });

    await this.redis.setJson(key, ruleSet, TTL_SECONDS);
    return ruleSet;
  }

  async getFieldSchema(tenantId: string): Promise<FieldSchema> {
    const key = fieldsKey(tenantId);
    const cached = await this.redis.getJson<FieldSchema>(key);
    if (cached) return cached;

    const fields = await this.tenantPrisma.forTenant(tenantId).fieldDefinition.findMany({
      select: {
        name: true,
        type: true,
        unit: true,
        precision: true,
        nullable: true,
        defaultIfMissing: true,
        source: true,
        enumValues: true,
        lookupUrl: true,
        lookupFallback: true,
      },
    });
    const schema: FieldSchema = Object.fromEntries(
      fields.map((f) => {
        const meta: FieldMeta = { type: f.type };
        if (f.unit) meta.unit = f.unit;
        if (f.precision !== null) meta.precision = f.precision;
        if (f.nullable === false) meta.nullable = false;
        if (f.defaultIfMissing !== null) meta.defaultIfMissing = f.defaultIfMissing;
        if (f.source && f.source !== 'payload') meta.source = f.source;
        if (f.enumValues.length > 0) meta.enumValues = f.enumValues;
        if (f.source === 'looked_up') {
          if (f.lookupUrl) meta.lookupUrl = f.lookupUrl;
          meta.lookupFallback = f.lookupFallback;
        }
        return [f.name, meta];
      }),
    );

    await this.redis.setJson(key, schema, TTL_SECONDS);
    return schema;
  }

  async getManagedLists(tenantId: string): Promise<ManagedListMap> {
    const key = listsKey(tenantId);
    const cached = await this.redis.getJson<ManagedListMap>(key);
    if (cached) return cached;

    const lists = await this.tenantPrisma
      .forTenant(tenantId)
      .managedList.findMany({ select: { name: true, values: true } });
    const map: ManagedListMap = Object.fromEntries(lists.map((l) => [l.name, l.values]));

    await this.redis.setJson(key, map, TTL_SECONDS);
    return map;
  }

  async invalidateRuleSet(tenantId: string, context: string): Promise<void> {
    await this.redis.del(ruleSetKey(tenantId, context));
  }

  async invalidateFieldSchema(tenantId: string): Promise<void> {
    await this.redis.del(fieldsKey(tenantId));
  }

  async invalidateManagedLists(tenantId: string): Promise<void> {
    await this.redis.del(listsKey(tenantId));
  }
}
