import type { PrismaClient } from '@prisma/client';
import { generateApprovalToken } from '@approvex/shared/approval-tokens';
import { env } from '../env';
import type { Mailer } from '../mailer';

/**
 * Fallback link lifetime when the step carries no SLA due date. Mirrors the
 * API's DEFAULT_TTL_MS (7 days) so a link minted here and one issued via the
 * API expire on the same clock.
 */
const APPROVAL_LINK_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Email notifications, driven by claim timestamps on the rows themselves:
 *
 *  - pending steps with notified_at NULL → mail every eligible approver
 *    (active role members minus the requester — maker-checker holds in mail
 *    too), then stamp notified_at. Escalation resets the stamp so the new
 *    role hears about it.
 *  - decided requests with completion_notified_at NULL → mail the requester.
 *
 * Claims are updateMany({ where: ..., data: stamp }) — the row is stamped
 * BEFORE sending (at-most-once; a duplicate "please approve" mail is worse
 * than a lost one, the inbox UI is the source of truth).
 */

export interface NotificationStats {
  stepNotices: number;
  decisionNotices: number;
}

export async function sendPendingNotifications(
  prisma: PrismaClient,
  mailer: Mailer,
): Promise<NotificationStats> {
  const stats: NotificationStats = { stepNotices: 0, decisionNotices: 0 };

  // ----- newly activated (or escalated) steps → approvers
  const steps = await prisma.requestStep.findMany({
    where: { status: 'pending', notifiedAt: null },
    take: 50,
    include: { request: { select: { id: true, title: true, context: true, createdById: true } } },
  });
  for (const step of steps) {
    const claimed = await prisma.requestStep.updateMany({
      where: { id: step.id, notifiedAt: null },
      data: { notifiedAt: new Date() },
    });
    if (claimed.count === 0) continue; // another worker got it

    const members = await prisma.userRole.findMany({
      where: {
        tenantId: step.tenantId,
        roleId: step.assignedRoleId,
        user: { status: 'active' },
      },
      select: { user: { select: { id: true, email: true, name: true } } },
    });
    const recipients = members
      .map((membership) => membership.user)
      .filter((user) => user.id !== step.request.createdById);

    const title = step.request.title ?? step.request.context ?? 'a request';
    const expiresAt = step.dueAt ?? new Date(Date.now() + APPROVAL_LINK_TTL_MS);
    for (const recipient of recipients) {
      // Each approver gets their own single-use link. The token authenticates as
      // this specific user, so the decision is attributed to them — never share
      // the raw token, which lives only in this URL and is never persisted.
      const { token, tokenHash } = generateApprovalToken();
      const created = await prisma.approvalToken.create({
        data: {
          tenantId: step.tenantId,
          stepId: step.id,
          userId: recipient.id,
          tokenHash,
          channel: 'email',
          allowedActions: ['approve', 'reject'],
          expiresAt,
        },
      });
      await prisma.auditEvent.create({
        data: {
          tenantId: step.tenantId,
          actorType: 'system',
          eventType: 'approval_token.issued',
          entityType: 'approval_token',
          entityId: created.id,
          // Non-secret metadata only — never the raw token or its hash.
          after: { channel: 'email', stepId: step.id, userId: recipient.id },
        },
      });
      const approveUrl = `${env.webAppUrl}/approve/${token}`;
      await mailer.send(
        recipient.email,
        `Approval needed: ${title}`,
        `Hi ${recipient.name},\n\n` +
          `A request is waiting on you in ApproveX: "${title}" (step ${step.nodeId}).\n` +
          (step.dueAt ? `It is due by ${step.dueAt.toISOString()}.\n` : '') +
          `\nApprove or reject in one click (no login needed):\n${approveUrl}\n` +
          `\nOr open your inbox to review the full request.\n`,
      );
      stats.stepNotices += 1;
    }
  }

  // ----- decided requests → requester
  const decided = await prisma.request.findMany({
    where: {
      status: { in: ['approved', 'rejected'] },
      completedAt: { not: null },
      completionNotifiedAt: null,
    },
    take: 50,
    select: {
      id: true,
      tenantId: true,
      title: true,
      context: true,
      status: true,
      createdById: true,
    },
  });
  for (const request of decided) {
    const claimed = await prisma.request.updateMany({
      where: { id: request.id, completionNotifiedAt: null },
      data: { completionNotifiedAt: new Date() },
    });
    if (claimed.count === 0) continue;

    // Machine-created requests (createdById is an API key) get webhooks, not mail.
    const creator = await prisma.user.findUnique({ where: { id: request.createdById } });
    if (!creator || creator.status !== 'active') continue;

    const title = request.title ?? request.context ?? 'your request';
    await mailer.send(
      creator.email,
      `Request ${request.status}: ${title}`,
      `Hi ${creator.name},\n\n"${title}" was ${request.status}.\n\n` +
        `Open ApproveX for the full decision trail.\n`,
    );
    stats.decisionNotices += 1;
  }

  return stats;
}
