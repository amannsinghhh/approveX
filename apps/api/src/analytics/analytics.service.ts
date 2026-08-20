import { Injectable } from '@nestjs/common';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';

/**
 * Tenant analytics (Phase 7). Raw SQL runs through transactionForTenant so
 * the RLS context is set — the forTenant() extension only wraps model
 * operations, never $queryRaw.
 */

export interface AnalyticsSummary {
  windowDays: number;
  totals: { total: number; pending: number; approved: number; rejected: number; cancelled: number };
  approvalRatePct: number | null;
  avgDecisionHours: number | null;
  medianDecisionHours: number | null;
  slaBreaches: number;
  escalations: number;
  byDay: { date: string; created: number; approved: number; rejected: number }[];
  /** Per workflow step (node_id): where approvals spend their time. */
  bySteps: {
    nodeId: string;
    count: number;
    avgHours: number | null;
    escalations: number;
    slaBreaches: number;
  }[];
  topRules: { ruleId: string; name: string; version: number; count: number }[];
  byContext: { context: string; count: number }[];
  webhooks: { delivered: number; pending: number; deadLettered: number };
}

interface Row {
  [key: string]: unknown;
}

const num = (value: unknown): number => Number(value ?? 0);

@Injectable()
export class AnalyticsService {
  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  async summary(tenantId: string, windowDays: number): Promise<AnalyticsSummary> {
    const since = new Date(Date.now() - windowDays * 86400_000);

    return this.tenantPrisma.transactionForTenant(tenantId, async (tx) => {
      const [
        statusRows,
        decisionRows,
        stepRows,
        dayRows,
        ruleRows,
        contextRows,
        webhookRows,
        stepBreakdownRows,
      ] = await Promise.all([
          tx.$queryRaw<Row[]>`
            SELECT status::text AS status, count(*)::int AS count
            FROM requests WHERE created_at >= ${since}
            GROUP BY status`,
          tx.$queryRaw<Row[]>`
            SELECT
              avg(EXTRACT(EPOCH FROM (completed_at - created_at)) / 3600) AS avg_hours,
              percentile_cont(0.5) WITHIN GROUP (
                ORDER BY EXTRACT(EPOCH FROM (completed_at - created_at)) / 3600
              ) AS median_hours
            FROM requests
            WHERE created_at >= ${since} AND completed_at IS NOT NULL
              AND status IN ('approved', 'rejected')`,
          tx.$queryRaw<Row[]>`
            SELECT
              count(*) FILTER (WHERE sla_breached_at IS NOT NULL)::int AS breaches,
              count(*) FILTER (WHERE escalated_to_role_id IS NOT NULL)::int AS escalations
            FROM request_steps WHERE created_at >= ${since}`,
          tx.$queryRaw<Row[]>`
            SELECT
              to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS date,
              count(*)::int AS created,
              count(*) FILTER (WHERE status = 'approved')::int AS approved,
              count(*) FILTER (WHERE status = 'rejected')::int AS rejected
            FROM requests WHERE created_at >= ${since}
            GROUP BY 1 ORDER BY 1`,
          tx.$queryRaw<Row[]>`
            SELECT r.id AS rule_id, r.name, rv.version, count(*)::int AS count
            FROM requests req
            JOIN rule_versions rv ON rv.id = req.matched_rule_version_id
            JOIN rules r ON r.id = rv.rule_id
            WHERE req.created_at >= ${since}
            GROUP BY r.id, r.name, rv.version
            ORDER BY count DESC LIMIT 5`,
          tx.$queryRaw<Row[]>`
            SELECT context, count(*)::int AS count
            FROM requests WHERE created_at >= ${since} AND context IS NOT NULL
            GROUP BY context ORDER BY count DESC LIMIT 8`,
          tx.$queryRaw<Row[]>`
            SELECT status::text AS status, count(*)::int AS count
            FROM webhook_outbox WHERE created_at >= ${since}
            GROUP BY status`,
          tx.$queryRaw<Row[]>`
            SELECT
              node_id,
              count(*)::int AS count,
              avg(EXTRACT(EPOCH FROM (completed_at - created_at)) / 3600)
                FILTER (WHERE completed_at IS NOT NULL) AS avg_hours,
              count(*) FILTER (WHERE escalated_to_role_id IS NOT NULL)::int AS escalations,
              count(*) FILTER (WHERE sla_breached_at IS NOT NULL)::int AS breaches
            FROM request_steps WHERE created_at >= ${since}
            GROUP BY node_id
            ORDER BY avg_hours DESC NULLS LAST
            LIMIT 12`,
        ]);

      const byStatus = new Map(statusRows.map((row) => [String(row.status), num(row.count)]));
      const approved = byStatus.get('approved') ?? 0;
      const rejected = byStatus.get('rejected') ?? 0;
      const decided = approved + rejected;
      const webhookByStatus = new Map(
        webhookRows.map((row) => [String(row.status), num(row.count)]),
      );

      return {
        windowDays,
        totals: {
          total: [...byStatus.values()].reduce((sum, count) => sum + count, 0),
          pending: byStatus.get('pending') ?? 0,
          approved,
          rejected,
          cancelled: byStatus.get('cancelled') ?? 0,
        },
        approvalRatePct: decided > 0 ? Math.round((approved / decided) * 1000) / 10 : null,
        avgDecisionHours:
          decisionRows[0]?.avg_hours != null
            ? Math.round(num(decisionRows[0].avg_hours) * 10) / 10
            : null,
        medianDecisionHours:
          decisionRows[0]?.median_hours != null
            ? Math.round(num(decisionRows[0].median_hours) * 10) / 10
            : null,
        slaBreaches: num(stepRows[0]?.breaches),
        escalations: num(stepRows[0]?.escalations),
        byDay: dayRows.map((row) => ({
          date: String(row.date),
          created: num(row.created),
          approved: num(row.approved),
          rejected: num(row.rejected),
        })),
        bySteps: stepBreakdownRows.map((row) => ({
          nodeId: String(row.node_id),
          count: num(row.count),
          avgHours: row.avg_hours != null ? Math.round(num(row.avg_hours) * 10) / 10 : null,
          escalations: num(row.escalations),
          slaBreaches: num(row.breaches),
        })),
        topRules: ruleRows.map((row) => ({
          ruleId: String(row.rule_id),
          name: String(row.name),
          version: num(row.version),
          count: num(row.count),
        })),
        byContext: contextRows.map((row) => ({
          context: String(row.context),
          count: num(row.count),
        })),
        webhooks: {
          delivered: webhookByStatus.get('delivered') ?? 0,
          pending: (webhookByStatus.get('pending') ?? 0) + (webhookByStatus.get('delivering') ?? 0),
          deadLettered: webhookByStatus.get('dead_letter') ?? 0,
        },
      } satisfies AnalyticsSummary;
    });
  }
}
