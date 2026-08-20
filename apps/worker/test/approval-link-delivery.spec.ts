import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashApprovalToken } from '@approvex/shared/approval-tokens';
import { createPrisma } from '../src/db';
import { env } from '../src/env';
import type { Mailer } from '../src/mailer';
import { sendPendingNotifications } from '../src/processors/send-notifications';
import { seedRequest, seedRole, seedStep, seedTenant, seedUser, seedWorkflowVersion } from './seed';

/**
 * CP2.4 — end-to-end of the *delivery* half of no-login approvals.
 *
 * The API e2e suite (approval-tokens.e2e-spec) proves that a minted token drives
 * every branch of the consume path. What that suite mints by hand, this one
 * proves the WORKER produces for real: when a step goes pending, the outbound
 * mail must carry a `/approve/<token>` link whose token is a valid, single-use
 * credential bound to the right step and approver — with only its hash ever
 * touching the database. Together the two suites cover the whole click: worker
 * mints & delivers → link → API consumes → workflow advances.
 */
interface SentMail {
  to: string;
  subject: string;
  text: string;
}

function collectingMailer(): { mailer: Mailer; sent: SentMail[] } {
  const sent: SentMail[] = [];
  return {
    sent,
    mailer: {
      send: (to, subject, text) => {
        sent.push({ to, subject, text });
        return Promise.resolve();
      },
    },
  };
}

/** The one-click link the approver is meant to tap, exactly as embedded. */
const APPROVE_URL_RE = /\/approve\/([a-f0-9]+)/;
const extractToken = (text: string): string | null => APPROVE_URL_RE.exec(text)?.[1] ?? null;

describe('approval link delivery (e2e)', () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = createPrisma();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("embeds a valid, correctly-bound one-click link in the approver's mail", async () => {
    const { tenantId } = await seedTenant(prisma);
    const financeRole = await seedRole(prisma, tenantId, 'Finance');
    // The requester is also in the approver role — maker-checker must give them
    // no link, even though they'd otherwise be a role member.
    const requester = await seedUser(prisma, tenantId, 'Requester', financeRole);
    const approver = await seedUser(prisma, tenantId, 'Priya Approver', financeRole);
    const versionId = await seedWorkflowVersion(prisma, tenantId, { roleId: financeRole, quorum: 'any' });
    const requestId = await seedRequest(prisma, tenantId, versionId, requester.id, {
      title: 'Vendor payment ₹1,000',
      payload: { amount: 1000 },
    });
    const dueAt = new Date(Date.now() + 3600_000);
    const stepId = await seedStep(prisma, tenantId, requestId, financeRole, { dueAt });

    const { mailer, sent } = collectingMailer();
    await sendPendingNotifications(prisma, mailer);

    // The approver — and only the approver — is mailed about this request.
    const mine = sent.filter((m) => m.subject.includes('Vendor payment ₹1,000'));
    expect(mine.map((m) => m.to)).toEqual([approver.email]);
    const mail = mine[0]!;
    expect(mail.subject).toBe('Approval needed: Vendor payment ₹1,000');

    // The body carries a fully-qualified /approve/<token> link at the real web origin.
    expect(mail.text).toContain(`${env.webAppUrl}/approve/`);
    const token = extractToken(mail.text);
    expect(token).toBeTruthy();

    // The token in the URL is the credential that unlocks THIS step for THIS user.
    const row = await prisma.approvalToken.findFirst({
      where: { tokenHash: hashApprovalToken(token!) },
    });
    expect(row).not.toBeNull();
    expect(row!.stepId).toBe(stepId);
    expect(row!.userId).toBe(approver.id);
    expect(row!.tenantId).toBe(tenantId);
    expect(row!.channel).toBe('email');
    expect(row!.allowedActions).toEqual(['approve', 'reject']);
    expect(row!.consumedAt).toBeNull(); // still spendable — a real click would act
    expect(row!.expiresAt.getTime()).toBe(dueAt.getTime()); // link inherits the step SLA

    // Only the hash is persisted — the raw secret lives solely in the URL.
    expect(row!.tokenHash).not.toBe(token);
    expect(JSON.stringify(row)).not.toContain(token);

    // The mint is audited without leaking the secret or its hash.
    const audit = await prisma.auditEvent.findFirst({
      where: { entityId: row!.id, eventType: 'approval_token.issued' },
    });
    expect(audit).not.toBeNull();
    expect(audit!.entityType).toBe('approval_token');
    expect(audit!.actorType).toBe('system');
    expect(audit!.after).toMatchObject({ channel: 'email', stepId, userId: approver.id });
    const auditJson = JSON.stringify(audit);
    expect(auditJson).not.toContain(token);
    expect(auditJson).not.toContain(row!.tokenHash);

    // The maker never receives a link, even sharing the approver role.
    expect(sent.filter((m) => m.to === requester.email && APPROVE_URL_RE.test(m.text))).toHaveLength(0);
  });

  it('gives each approver their own distinct single-use link', async () => {
    const { tenantId } = await seedTenant(prisma);
    const financeRole = await seedRole(prisma, tenantId, 'Finance');
    const requester = await seedUser(prisma, tenantId, 'Requester');
    const alice = await seedUser(prisma, tenantId, 'Alice', financeRole);
    const bob = await seedUser(prisma, tenantId, 'Bob', financeRole);
    const versionId = await seedWorkflowVersion(prisma, tenantId, { roleId: financeRole, quorum: 'all' });
    const requestId = await seedRequest(prisma, tenantId, versionId, requester.id, {
      title: 'Vendor payment ₹2,000',
      payload: { amount: 2000 },
    });
    const stepId = await seedStep(prisma, tenantId, requestId, financeRole);

    const { mailer, sent } = collectingMailer();
    await sendPendingNotifications(prisma, mailer);

    const byUser = new Map<string, string>(); // email -> token
    for (const email of [alice.email, bob.email]) {
      const mail = sent.find((m) => m.to === email && m.subject.includes('Vendor payment ₹2,000'));
      expect(mail, `expected a link mail for ${email}`).toBeTruthy();
      const token = extractToken(mail!.text);
      expect(token).toBeTruthy();
      byUser.set(email, token!);
    }

    // Two different secrets — one approver's link can never act as the other.
    expect(byUser.get(alice.email)).not.toBe(byUser.get(bob.email));

    // Each token resolves to a row bound to exactly that approver on this step.
    for (const [email, userId] of [
      [alice.email, alice.id],
      [bob.email, bob.id],
    ] as const) {
      const row = await prisma.approvalToken.findFirst({
        where: { tokenHash: hashApprovalToken(byUser.get(email)!) },
      });
      expect(row).not.toBeNull();
      expect(row!.stepId).toBe(stepId);
      expect(row!.userId).toBe(userId);
    }
  });

  it('mints no new link on a re-sweep of an already-notified step', async () => {
    const { tenantId } = await seedTenant(prisma);
    const financeRole = await seedRole(prisma, tenantId, 'Finance');
    const requester = await seedUser(prisma, tenantId, 'Requester');
    const approver = await seedUser(prisma, tenantId, 'Solo Approver', financeRole);
    const versionId = await seedWorkflowVersion(prisma, tenantId, { roleId: financeRole, quorum: 'any' });
    const requestId = await seedRequest(prisma, tenantId, versionId, requester.id, {
      title: 'Vendor payment ₹3,000',
      payload: { amount: 3000 },
    });
    const stepId = await seedStep(prisma, tenantId, requestId, financeRole);

    await sendPendingNotifications(prisma, collectingMailer().mailer);
    const afterFirst = await prisma.approvalToken.count({ where: { stepId } });
    expect(afterFirst).toBe(1);

    const second = collectingMailer();
    await sendPendingNotifications(prisma, second.mailer);
    // No fresh link, no duplicate "please approve" mail — notifiedAt claimed the step.
    expect(await prisma.approvalToken.count({ where: { stepId } })).toBe(1);
    expect(second.sent.filter((m) => m.to === approver.email)).toHaveLength(0);
  });
});
