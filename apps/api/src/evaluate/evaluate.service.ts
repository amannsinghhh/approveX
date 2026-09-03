import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import type {
  EvalContext,
  EvaluationResult,
  RuleTraceType,
  StructuredTrace,
  TraceEntry,
} from '../../../../shared/src/index';
import type { AggregateRef } from '../../../../shared/src/index';
import {
  DEFAULT_FISCAL_YEAR_START_MONTH,
  DEFAULT_TIMEZONE,
  collectAggregateRefs,
  collectLookupFields,
  evaluateCondition,
  evaluateScoring,
  toStructuredTrace,
} from '../../../../shared/src/index';
import { AuditService } from '../audit/audit.service';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import type { PendingApprover } from '../requests/request-engine.service';
import { RequestEngineService } from '../requests/request-engine.service';
import { RequestsService } from '../requests/requests.service';
import type { PublishedRule } from '../rules/rule-cache.service';
import { RuleCacheService } from '../rules/rule-cache.service';
import { AggregateProviderService } from './aggregate-provider.service';
import type { EvaluateDto } from './evaluate.schemas';
import { LookupProviderService } from './lookup-provider.service';

export type NoMatchPolicy = 'treat_as_no_match' | 'reject_request';

interface EvaluatedRule {
  rule: PublishedRule;
  evaluation: EvaluationResult;
}

interface MatchOutcome {
  winner: EvaluatedRule | null;
  ranked: EvaluatedRule[];
  noMatchPolicy: NoMatchPolicy;
}

interface MatchSummary {
  matched: boolean;
  matchedRuleId: string | null;
  matchedRuleName: string | null;
  matchedRuleVersionId: string | null;
  matchedRuleVersion: number | null;
  priorityUsed: number | null;
  /** How the winner reached its verdict (B.5). Null when nothing matched. */
  ruleType: RuleTraceType | null;
  /** Structured B.5 trace of the winning rule. */
  evaluationTrace: StructuredTrace | null;
  /** The full ranked set that was weighed (capped) — the "other rules considered". */
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
  /** Total rules evaluated — matchesConsidered is capped for response size. */
  rulesConsidered: number;
  noMatch: boolean;
  noMatchPolicy: NoMatchPolicy;
}

/**
 * The ranking is capped (Phase 7 hardening): with 1k published rules an
 * uncapped list weighed ~145KB per response and alone blew the p95 < 50ms
 * budget. The winner is always ranked[0] of the visible slice.
 */
const MAX_MATCHES_CONSIDERED = 25;

export interface DryRunResponse extends MatchSummary {
  mode: 'dry_run';
  context: string;
  /** Phase 5+: preview graph of the bound workflow. */
  wouldStartWorkflow: { workflowId: string; workflowName: string } | null;
}

export interface ExecuteResponse extends MatchSummary {
  mode: 'execute';
  context: string;
  requestId: string | null;
  status: string | null;
  pendingApprovers: PendingApprover[] | null;
}

@Injectable()
export class EvaluateService {
  constructor(
    private readonly ruleCache: RuleCacheService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly audit: AuditService,
    private readonly requests: RequestsService,
    private readonly engine: RequestEngineService,
    private readonly aggregateProvider: AggregateProviderService,
    private readonly lookupProvider: LookupProviderService,
  ) {}

  async evaluate(
    tenantId: string,
    actorUserId: string,
    dto: EvaluateDto,
    idempotencyKey?: string,
    ip?: string,
  ) {
    return dto.mode === 'execute'
      ? this.execute(tenantId, actorUserId, dto, idempotencyKey, ip)
      : this.dryRun(tenantId, actorUserId, dto, ip);
  }

  // ------------------------------------------------------------- matching

  /** Deterministic conflict resolution (spec §2.8): priority ↑, specificity ↓, age ↑. */
  private async match(tenantId: string, dto: EvaluateDto): Promise<MatchOutcome> {
    const [ruleSet, fieldSchema, managedLists, tenantConfig] = await Promise.all([
      this.ruleCache.getPublishedRuleSet(tenantId, dto.context),
      this.ruleCache.getFieldSchema(tenantId),
      this.ruleCache.getManagedLists(tenantId),
      this.tenantConfig(tenantId),
    ]);
    const { noMatchPolicy, context } = tenantConfig;

    const now = context.now ?? Date.now();
    const effective = ruleSet.filter(
      (rule) =>
        (!rule.effectiveFrom || Date.parse(rule.effectiveFrom) <= now) &&
        (!rule.effectiveTo || Date.parse(rule.effectiveTo) >= now),
    );

    // Aggregate pre-scan (M5-CP2): one deduped provider round-trip for every
    // aggregate any effective rule would look up for this payload. Absent keys
    // fail closed in the evaluator (`missing_aggregate`).
    const refsByKey = new Map<string, AggregateRef>();
    for (const rule of effective) {
      if (rule.ruleType !== 'condition_tree') continue;
      for (const ref of collectAggregateRefs(rule.conditionAst, dto.data, fieldSchema)) {
        if (!refsByKey.has(ref.key)) refsByKey.set(ref.key, ref);
      }
    }
    // Lookup pre-scan (M5-CP3): resolve every `source: looked_up` field any
    // effective rule compares, one call per field with per-field fallback
    // behavior. Unresolved fields fail closed in the evaluator (`missing_lookup`).
    const lookupFields = new Set<string>();
    for (const rule of effective) {
      if (rule.ruleType !== 'condition_tree') continue;
      for (const field of collectLookupFields(rule.conditionAst, fieldSchema)) {
        lookupFields.add(field);
      }
    }
    const [aggregates, lookups] = await Promise.all([
      refsByKey.size > 0
        ? this.aggregateProvider.getAggregates(tenantId, [...refsByKey.values()], context)
        : Promise.resolve(undefined),
      lookupFields.size > 0
        ? this.lookupProvider.getLookups(tenantId, [...lookupFields], fieldSchema, dto.data)
        : Promise.resolve(undefined),
    ]);

    // Fast path over the whole set (no traces, short-circuit allowed — same
    // verdicts); the winner is re-run with the full trace below. Sandbox
    // callers asking for includeTraces get traced evaluation throughout.
    const collectTrace = dto.includeTraces === true;
    const evaluate = (rule: PublishedRule, traced: boolean): EvaluationResult => {
      const options = {
        fieldSchema,
        managedLists,
        collectTrace: traced,
        context,
        aggregates,
        lookups,
      };
      return rule.ruleType === 'scoring'
        ? evaluateScoring(rule.scoringSpec, dto.data, options)
        : evaluateCondition(rule.conditionAst, dto.data, options);
    };

    const ranked = effective
      .map((rule) => ({ rule, evaluation: evaluate(rule, collectTrace) }))
      .sort((a, b) => {
        if (a.rule.priority !== b.rule.priority) return a.rule.priority - b.rule.priority;
        if (a.rule.conditionCount !== b.rule.conditionCount) {
          return b.rule.conditionCount - a.rule.conditionCount;
        }
        return Date.parse(a.rule.ruleCreatedAt) - Date.parse(b.rule.ruleCreatedAt);
      });

    const winner = ranked.find((entry) => entry.evaluation.matched) ?? null;
    if (winner && !collectTrace) {
      winner.evaluation = evaluate(winner.rule, true);
    }

    return { winner, ranked, noMatchPolicy };
  }

  private summarize(outcome: MatchOutcome, includeTraces: boolean): MatchSummary {
    const { winner, ranked, noMatchPolicy } = outcome;
    return {
      matched: winner !== null,
      matchedRuleId: winner?.rule.ruleId ?? null,
      matchedRuleName: winner?.rule.ruleName ?? null,
      matchedRuleVersionId: winner?.rule.versionId ?? null,
      matchedRuleVersion: winner?.rule.version ?? null,
      priorityUsed: winner?.rule.priority ?? null,
      ruleType: winner?.rule.ruleType ?? null,
      evaluationTrace: winner ? toStructuredTrace(winner.evaluation, winner.rule.ruleType) : null,
      matchesConsidered: ranked.slice(0, MAX_MATCHES_CONSIDERED).map((entry) => ({
        ruleId: entry.rule.ruleId,
        ruleName: entry.rule.ruleName,
        version: entry.rule.version,
        priority: entry.rule.priority,
        ruleType: entry.rule.ruleType,
        conditionCount: entry.rule.conditionCount,
        matched: entry.evaluation.matched,
        ...(includeTraces ? { trace: entry.evaluation.trace } : {}),
      })),
      rulesConsidered: ranked.length,
      noMatch: winner === null,
      noMatchPolicy,
    };
  }

  /** Resolves the matched rule version's workflow binding → current published version. */
  private async resolveWorkflow(tenantId: string, ruleVersionId: string) {
    const client = this.tenantPrisma.forTenant(tenantId);
    const binding = await client.ruleWorkflowBinding.findUnique({
      where: { ruleVersionId },
      include: {
        workflow: {
          include: {
            versions: {
              where: { publishedAt: { not: null } },
              orderBy: { version: 'desc' },
              take: 1,
            },
          },
        },
      },
    });
    if (!binding) return null;
    const version = binding.workflow.versions[0];
    if (binding.workflow.status !== 'published' || !version) return null;
    return { workflow: binding.workflow, version };
  }

  // --------------------------------------------------------------- dry run

  private async dryRun(
    tenantId: string,
    actorUserId: string,
    dto: EvaluateDto,
    ip?: string,
  ): Promise<DryRunResponse> {
    const outcome = await this.match(tenantId, dto);
    const summary = this.summarize(outcome, dto.includeTraces);

    let wouldStartWorkflow: DryRunResponse['wouldStartWorkflow'] = null;
    if (outcome.winner) {
      const resolved = await this.resolveWorkflow(tenantId, outcome.winner.rule.versionId);
      if (resolved) {
        wouldStartWorkflow = {
          workflowId: resolved.workflow.id,
          workflowName: resolved.workflow.name,
        };
      }
    }

    // The one permitted piece of dry-run audit noise (spec §5).
    await this.audit.record({
      tenantId,
      actorUserId,
      eventType: 'evaluate.dry_run',
      entityType: 'evaluation',
      after: {
        context: dto.context,
        matched: summary.matched,
        matchedRuleId: summary.matchedRuleId,
        matchedRuleVersion: summary.matchedRuleVersion,
        rulesConsidered: summary.matchesConsidered.length,
      },
      ip,
    });

    return { mode: 'dry_run', context: dto.context, ...summary, wouldStartWorkflow };
  }

  // --------------------------------------------------------------- execute

  private async execute(
    tenantId: string,
    actorUserId: string,
    dto: EvaluateDto,
    idempotencyKey?: string,
    ip?: string,
  ): Promise<ExecuteResponse | unknown> {
    if (idempotencyKey) {
      const replay = await this.requests.findByIdempotencyKey(tenantId, idempotencyKey);
      if (replay) return replay;
    }

    const outcome = await this.match(tenantId, dto);
    const summary = this.summarize(outcome, dto.includeTraces);

    if (!outcome.winner) {
      await this.audit.record({
        tenantId,
        actorUserId,
        eventType:
          outcome.noMatchPolicy === 'reject_request'
            ? 'evaluate.rejected_no_match'
            : 'evaluate.no_match',
        entityType: 'evaluation',
        after: { context: dto.context, rulesConsidered: summary.matchesConsidered.length },
        ip,
      });
      return {
        mode: 'execute' as const,
        context: dto.context,
        ...summary,
        requestId: null,
        status: outcome.noMatchPolicy === 'reject_request' ? 'rejected' : null,
        pendingApprovers: null,
      };
    }

    const resolved = await this.resolveWorkflow(tenantId, outcome.winner.rule.versionId);
    if (!resolved) {
      throw new UnprocessableEntityException(
        `Rule "${outcome.winner.rule.ruleName}" matched but has no published workflow bound — ` +
          `bind one via PUT /rules/{id}/binding`,
      );
    }

    let described;
    try {
      described = await this.engine.instantiate({
        tenantId,
        actorUserId,
        workflowVersion: resolved.version,
        payload: dto.data,
        context: dto.context,
        matchedRuleVersionId: outcome.winner.rule.versionId,
        idempotencyKey,
        ip,
      });
    } catch (err) {
      if (
        idempotencyKey &&
        typeof err === 'object' &&
        err !== null &&
        (err as { code?: string }).code === 'P2002'
      ) {
        const replay = await this.requests.findByIdempotencyKey(tenantId, idempotencyKey);
        if (replay) return replay;
      }
      throw err;
    }

    const response: ExecuteResponse = {
      mode: 'execute',
      context: dto.context,
      ...summary,
      requestId: described.id,
      status: described.status,
      pendingApprovers: described.pendingApprovers,
    };
    if (idempotencyKey) {
      await this.requests.storeInitialResponse(tenantId, described.id, response);
    }
    return response;
  }

  /**
   * Tenant-level evaluation config from settings jsonb: the no-match policy plus
   * the temporal context (timezone, fiscal-year start) that date/time operators
   * resolve against. Defaults: Asia/Kolkata, fiscal year starts in April.
   */
  private async tenantConfig(
    tenantId: string,
  ): Promise<{ noMatchPolicy: NoMatchPolicy; context: EvalContext }> {
    const tenant = await this.tenantPrisma
      .forTenant(tenantId)
      .tenant.findUnique({ where: { id: tenantId }, select: { settings: true } });
    const settings = (tenant?.settings ?? {}) as Record<string, unknown>;

    const noMatchPolicy: NoMatchPolicy =
      settings.noMatchPolicy === 'reject_request' ? 'reject_request' : 'treat_as_no_match';

    const timezone = typeof settings.timezone === 'string' ? settings.timezone : DEFAULT_TIMEZONE;
    const fiscalYearStartMonth =
      typeof settings.fiscalYearStartMonth === 'number'
        ? settings.fiscalYearStartMonth
        : DEFAULT_FISCAL_YEAR_START_MONTH;

    return { noMatchPolicy, context: { timezone, fiscalYearStartMonth } };
  }
}
