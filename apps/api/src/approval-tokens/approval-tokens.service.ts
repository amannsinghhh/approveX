import {
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { generateApprovalToken, hashApprovalToken } from '../../../../shared/src/approval-tokens/index';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { RedisService } from '../redis/redis.service';
import { RequestEngineService } from '../requests/request-engine.service';

type NoLoginAction = 'approve' | 'reject';

/** Default no-login value ceiling (₹5,00,000) when a tenant hasn't set one. */
const DEFAULT_CEILING = 500_000;
/** Fallback link lifetime when the step carries no SLA due date (7 days). */
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const TOKEN_WINDOW_S = 600;
const IP_WINDOW_S = 60;
/** Read at call time (not module load) so tests can tune the burst deterministically. */
const tokenMaxAttempts = (): number => Number(process.env.APPROVAL_TOKEN_MAX_ATTEMPTS ?? 10);
const ipMaxAttempts = (): number => Number(process.env.APPROVAL_TOKEN_IP_MAX_ATTEMPTS ?? 60);

// Single source of truth for the hash contract lives in shared/ so the
// worker's minting and the API's verification can never drift apart.
const sha256 = (value: string): string => hashApprovalToken(value);

/**
 * The curated request detail shown on the public landing page. Deliberately a
 * narrow projection of what the engine knows — a forwarded email is a bearer
 * credential, so we surface only what a signer legitimately needs to decide:
 * the payload, the rule/workflow context, and who is (and was) in the loop.
 */
export interface LandingDetail {
  title: string | null;
  externalRef: string | null;
  /** The request payload as a key/value ledger (amount, vendor, everything). */
  payload: Record<string, unknown>;
  createdByName: string | null;
  createdAt: Date;
  /** "Matched rule Payments above ₹5,00,000 (v3)" */
  matchedRule: { name: string; version: number } | null;
  workflowName: string | null;
  /** The ordered approver chain by role, e.g. ['Manager','Finance Head','CFO']. */
  chain: string[];
  /** Where this step sits in the chain — drives "Step 2 of 3". */
  stepPosition: { index: number; total: number };
  /** Who has already decided, in order. */
  approvals: { approverName: string | null; action: NoLoginAction; actedAt: Date }[];
  /** Active approvers for the current step — who we're waiting on right now. */
  waitingOn: string[];
  dueAt: Date | null;
}

/** What a read-only look at a token reveals — drives the landing page render. */
export type ApprovalTokenView =
  | {
      state: 'valid';
      tenantId: string;
      stepId: string;
      requestId: string;
      approverName: string | null;
      allowedActions: NoLoginAction[];
      amount: number | null;
      ceiling: number;
      expiresAt: Date;
      detail: LandingDetail;
    }
  | { state: 'not_found' }
  | { state: 'expired'; expiresAt: Date }
  | { state: 'consumed'; action: NoLoginAction | null; consumedAt: Date }
  | { state: 'already_handled'; handledBy: string | null }
  | { state: 'over_ceiling'; amount: number; ceiling: number };

/** The result of trying to spend a token. */
export type ApprovalTokenOutcome =
  | { state: 'acted'; action: NoLoginAction; requestId: string; stepId: string }
  | { state: 'not_found' }
  | { state: 'expired' }
  | { state: 'consumed'; action: NoLoginAction | null; consumedAt: Date }
  | { state: 'already_handled'; handledBy: string | null }
  | { state: 'over_ceiling'; amount: number; ceiling: number }
  | { state: 'invalid_action'; reason: 'not_allowed' | 'comment_required' }
  | { state: 'forbidden'; message: string };

export interface IssueTokenParams {
  tenantId: string;
  stepId: string;
  /** The approver the link authenticates as — the action is attributed to them. */
  userId: string;
  channel: 'email' | 'whatsapp';
  allowedActions?: NoLoginAction[];
  /** Override the default expiry (defaults to the step's SLA due date, else +7d). */
  expiresAt?: Date;
}

export interface AttemptMeta {
  ip?: string | null;
  userAgent?: string | null;
  comment?: string;
}

/**
 * No-login signed approval links (spec Workstream A, Checkpoint 1). The raw
 * token lives only in the email/WhatsApp URL; we persist just its sha256, so it
 * cannot be recovered from the database, the logs, or an error message.
 *
 * Connection split: the landing page is pre-auth and has no tenant context, so
 * the token is resolved by hash on the OWNER connection (like AuditService).
 * Everything after resolution — reading the step/request, computing the value
 * ceiling, performing the action — runs under the token's own tenant so RLS and
 * maker-checker still apply.
 */
@Injectable()
export class ApprovalTokensService {
  private readonly logger = new Logger(ApprovalTokensService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly engine: RequestEngineService,
    private readonly audit: AuditService,
    private readonly redis: RedisService,
  ) {}

  /**
   * Mint a link for one approver on one step. Returns the raw token exactly
   * once — the caller hands it to the notification layer and then forgets it.
   */
  async issue(params: IssueTokenParams): Promise<{ id: string; token: string; expiresAt: Date }> {
    const client = this.tenantPrisma.forTenant(params.tenantId);
    const step = await client.requestStep.findUnique({ where: { id: params.stepId } });
    if (!step) throw new NotFoundException('Step not found');
    if (step.status !== 'pending') {
      throw new ConflictException('Cannot issue a link for a step that is no longer pending');
    }

    const { token, tokenHash } = generateApprovalToken();
    const expiresAt = params.expiresAt ?? step.dueAt ?? new Date(Date.now() + DEFAULT_TTL_MS);
    const allowedActions = params.allowedActions ?? (['approve', 'reject'] as NoLoginAction[]);

    const created = await client.approvalToken.create({
      data: {
        tenantId: params.tenantId,
        stepId: params.stepId,
        userId: params.userId,
        tokenHash,
        channel: params.channel,
        allowedActions,
        expiresAt,
      },
    });

    await this.audit.record({
      tenantId: params.tenantId,
      actorType: 'system',
      eventType: 'approval_token.issued',
      entityType: 'approval_token',
      entityId: created.id,
      // Never the raw token — only its non-secret metadata.
      after: { channel: params.channel, stepId: params.stepId, userId: params.userId, allowedActions },
    });

    return { id: created.id, token, expiresAt };
  }

  /**
   * Read-only view of a token. Writes nothing to the business tables (a `GET`
   * on the landing page must never mutate state). Suspicious lookups
   * (expired/decided) are recorded as security events.
   */
  async preview(rawToken: string, meta: AttemptMeta = {}): Promise<ApprovalTokenView> {
    const tokenHash = sha256(rawToken);
    await this.enforceRateLimit(meta.ip ?? null, tokenHash);

    const token = await this.prisma.approvalToken.findUnique({ where: { tokenHash } });
    if (!token) {
      this.logger.warn('Approval token preview: no match');
      return { state: 'not_found' };
    }
    if (token.consumedAt) {
      return {
        state: 'consumed',
        action: token.consumedAction as NoLoginAction | null,
        consumedAt: token.consumedAt,
      };
    }
    if (token.expiresAt.getTime() <= Date.now()) {
      await this.logSecurityEvent(token.tenantId, 'approval_token.expired', token.stepId, meta.ip);
      return { state: 'expired', expiresAt: token.expiresAt };
    }

    const ctx = await this.loadContext(token.tenantId, token.stepId);
    if (!ctx || ctx.step.status !== 'pending' || ctx.request.status !== 'pending') {
      return { state: 'already_handled', handledBy: await this.decidedBy(token.tenantId, token.stepId) };
    }

    const { amount, ceiling } = await this.evaluateCeiling(token.tenantId, ctx.request.payload);
    if (amount !== null && amount > ceiling) return { state: 'over_ceiling', amount, ceiling };

    return {
      state: 'valid',
      tenantId: token.tenantId,
      stepId: token.stepId,
      requestId: ctx.request.id,
      approverName: await this.userName(token.tenantId, token.userId),
      allowedActions: token.allowedActions as NoLoginAction[],
      amount,
      ceiling,
      expiresAt: token.expiresAt,
      detail: await this.buildLandingDetail(token.tenantId, ctx.request.id, token.stepId),
    };
  }

  /**
   * Assemble the public request detail for the landing page. Reuses the engine's
   * `describe()` — the same assembler the authenticated inbox uses — then narrows
   * it to the non-sensitive projection a no-login signer should see. Read-only.
   */
  private async buildLandingDetail(
    tenantId: string,
    requestId: string,
    currentStepId: string,
  ): Promise<LandingDetail> {
    const full = await this.engine.describe(tenantId, requestId);

    // Ordered chain of role names, resolved once for every step in the route.
    const roleIds = [...new Set(full.steps.map((step) => step.assignedRoleId))];
    const roles =
      roleIds.length > 0
        ? await this.tenantPrisma
            .forTenant(tenantId)
            .role.findMany({ where: { id: { in: roleIds } }, select: { id: true, name: true } })
        : [];
    const roleName = new Map(roles.map((role) => [role.id, role.name]));
    const chain = full.steps.map((step) => roleName.get(step.assignedRoleId) ?? 'Approver');

    const index = full.steps.findIndex((step) => step.id === currentStepId);

    // "Who has already approved" — the decisive action on each settled step.
    const approvals = full.steps
      .filter((step) => step.status === 'approved' || step.status === 'rejected')
      .map((step) => {
        const decisive = step.actions.find((a) => a.action === 'approve' || a.action === 'reject');
        return decisive
          ? {
              approverName: decisive.actorName,
              action: decisive.action as NoLoginAction,
              actedAt: decisive.actedAt as Date,
            }
          : null;
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

    // "Who we're waiting on right now" — eligible approvers of the current step.
    const currentPending = full.pendingApprovers.find((p) => p.stepId === currentStepId);
    const waitingOn = (currentPending?.eligibleUsers ?? []).map((user) => user.name);

    return {
      title: full.title ?? null,
      externalRef: full.externalRef ?? null,
      payload: (full.payload as Record<string, unknown>) ?? {},
      createdByName: full.createdBy?.name ?? null,
      createdAt: full.createdAt as Date,
      matchedRule: full.matchedRule
        ? { name: full.matchedRule.name, version: full.matchedRule.version }
        : null,
      workflowName: full.workflowVersion.workflowName,
      chain,
      stepPosition: { index: index >= 0 ? index + 1 : 1, total: full.steps.length },
      approvals,
      waitingOn,
      dueAt: (full.steps[index >= 0 ? index : 0]?.dueAt as Date | null) ?? null,
    };
  }

  /**
   * Spend a token to approve/reject a step. Single-use and race-safe: the
   * `consumed_at` flag is claimed with `WHERE consumed_at IS NULL`, so exactly
   * one of N concurrent taps proceeds to act; the rest see a friendly "already
   * approved" result rather than a 500.
   */
  async consume(rawToken: string, action: NoLoginAction, meta: AttemptMeta = {}): Promise<ApprovalTokenOutcome> {
    const tokenHash = sha256(rawToken);
    await this.enforceRateLimit(meta.ip ?? null, tokenHash);

    const token = await this.prisma.approvalToken.findUnique({ where: { tokenHash } });
    if (!token) {
      this.logger.warn('Approval token consume: no match');
      return { state: 'not_found' };
    }
    if (token.consumedAt) {
      await this.logSecurityEvent(token.tenantId, 'approval_token.reused', token.stepId, meta.ip);
      return {
        state: 'consumed',
        action: token.consumedAction as NoLoginAction | null,
        consumedAt: token.consumedAt,
      };
    }
    if (token.expiresAt.getTime() <= Date.now()) {
      await this.logSecurityEvent(token.tenantId, 'approval_token.expired', token.stepId, meta.ip);
      return { state: 'expired' };
    }
    if (!token.allowedActions.includes(action)) {
      return { state: 'invalid_action', reason: 'not_allowed' };
    }
    if (action === 'reject' && !meta.comment?.trim()) {
      return { state: 'invalid_action', reason: 'comment_required' };
    }

    // Check the step is still open BEFORE claiming, so an already-decided step
    // leaves the token unspent and keeps showing a stable "already handled" note.
    const ctx = await this.loadContext(token.tenantId, token.stepId);
    if (!ctx || ctx.step.status !== 'pending' || ctx.request.status !== 'pending') {
      return { state: 'already_handled', handledBy: await this.decidedBy(token.tenantId, token.stepId) };
    }
    const { amount, ceiling } = await this.evaluateCeiling(token.tenantId, ctx.request.payload);
    if (amount !== null && amount > ceiling) return { state: 'over_ceiling', amount, ceiling };

    // Atomic single-use claim on the owner connection.
    const claimed = await this.prisma.$queryRaw<{ id: string }[]>`
      UPDATE approval_tokens
         SET consumed_at = now(),
             consumed_action = ${action}::"step_action_type",
             consumed_ip = ${meta.ip ?? null},
             consumed_user_agent = ${meta.userAgent ?? null}
       WHERE token_hash = ${tokenHash} AND consumed_at IS NULL
      RETURNING id`;
    if (claimed.length === 0) {
      // Lost the race — another tap already claimed it.
      const fresh = await this.prisma.approvalToken.findUnique({ where: { tokenHash } });
      await this.logSecurityEvent(token.tenantId, 'approval_token.reused', token.stepId, meta.ip);
      return {
        state: 'consumed',
        action: (fresh?.consumedAction ?? null) as NoLoginAction | null,
        consumedAt: fresh?.consumedAt ?? new Date(),
      };
    }

    // Claim won — perform the action as the bound approver, tagged with the
    // delivery channel. The engine still enforces maker-checker, quorum, etc.
    try {
      await this.engine.act(
        token.tenantId,
        { userId: token.userId },
        token.stepId,
        action,
        { comment: meta.comment },
        meta.ip ?? undefined,
        token.channel,
      );
    } catch (err) {
      if (err instanceof ConflictException) {
        return { state: 'already_handled', handledBy: await this.decidedBy(token.tenantId, token.stepId) };
      }
      if (err instanceof ForbiddenException) {
        return { state: 'forbidden', message: err.message };
      }
      throw err;
    }

    await this.audit.record({
      tenantId: token.tenantId,
      actorUserId: token.userId,
      actorType: 'user',
      eventType: `request.step.${action}`,
      entityType: 'request_step',
      entityId: token.stepId,
      ip: meta.ip ?? null,
      after: { channel: token.channel, via: 'no_login_token' },
    });

    return { state: 'acted', action, requestId: ctx.request.id, stepId: token.stepId };
  }

  // --------------------------------------------------------------- internals

  private async loadContext(tenantId: string, stepId: string) {
    const step = await this.tenantPrisma
      .forTenant(tenantId)
      .requestStep.findUnique({ where: { id: stepId }, include: { request: true } });
    if (!step) return null;
    return { step, request: step.request };
  }

  private async decidedBy(tenantId: string, stepId: string): Promise<string | null> {
    const decided = await this.tenantPrisma.forTenant(tenantId).stepAction.findFirst({
      where: { stepId, action: { in: ['approve', 'reject'] } },
      orderBy: { actedAt: 'desc' },
    });
    return decided ? this.userName(tenantId, decided.actorUserId) : null;
  }

  private async userName(tenantId: string, userId: string): Promise<string | null> {
    const user = await this.tenantPrisma.forTenant(tenantId).user.findUnique({ where: { id: userId } });
    return user?.name ?? null;
  }

  /** Reads the tenant's no-login ceiling and the request amount to compare it against. */
  private async evaluateCeiling(
    tenantId: string,
    payload: unknown,
  ): Promise<{ amount: number | null; ceiling: number }> {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    const settings = (tenant?.settings ?? {}) as Record<string, unknown>;
    const rawCeiling = Number(settings.noLoginApprovalMaxAmount ?? DEFAULT_CEILING);
    const ceiling = Number.isFinite(rawCeiling) ? rawCeiling : DEFAULT_CEILING;
    const field =
      typeof settings.noLoginApprovalAmountField === 'string'
        ? settings.noLoginApprovalAmountField
        : 'amount';

    const bag = (payload ?? {}) as Record<string, unknown>;
    const raw = bag[field];
    let amount: number | null = null;
    if (typeof raw === 'number' && Number.isFinite(raw)) amount = raw;
    else if (typeof raw === 'string' && raw.trim() !== '' && Number.isFinite(Number(raw))) {
      amount = Number(raw);
    }
    return { amount, ceiling };
  }

  private async logSecurityEvent(
    tenantId: string,
    eventType: string,
    stepId: string,
    ip?: string | null,
  ): Promise<void> {
    await this.audit.record({
      tenantId,
      actorType: 'system',
      eventType,
      entityType: 'approval_token',
      entityId: stepId,
      ip: ip ?? null,
    });
  }

  /**
   * Per-token and per-IP fixed-window limiter over Redis. Redis down ⇒ fail
   * OPEN, matching the rest of the platform: availability of the approval flow
   * beats limiter precision.
   */
  private async enforceRateLimit(ip: string | null, tokenHash: string): Promise<void> {
    const buckets: Array<{ key: string; max: number; ttl: number }> = [
      { key: `atl:tok:${tokenHash}`, max: tokenMaxAttempts(), ttl: TOKEN_WINDOW_S },
    ];
    if (ip) buckets.push({ key: `atl:ip:${ip}`, max: ipMaxAttempts(), ttl: IP_WINDOW_S });

    for (const { key, max, ttl } of buckets) {
      try {
        const count = await this.redis.client.incr(key);
        if (count === 1) await this.redis.client.expire(key, ttl);
        if (count > max) {
          throw new HttpException(
            { statusCode: 429, message: 'Too many attempts. Please slow down and try again.' },
            429,
          );
        }
      } catch (err) {
        if (err instanceof HttpException) throw err;
        // Redis unavailable — fail open.
      }
    }
  }
}
