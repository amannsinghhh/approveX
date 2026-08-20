import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrisma } from '../src/db';
import type { Mailer } from '../src/mailer';
import { sendPendingNotifications } from '../src/processors/send-notifications';
import { seedRequest, seedRole, seedStep, seedTenant, seedUser, seedWorkflowVersion } from './seed';

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

describe('notifications', () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = createPrisma();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('mails eligible approvers (minus the requester) once per step', async () => {
    const { tenantId } = await seedTenant(prisma);
    const financeRole = await seedRole(prisma, tenantId, 'Finance');
    // the requester is ALSO in the approver role — maker-checker must skip them
    const requester = await seedUser(prisma, tenantId, 'Requester', financeRole);
    const approver = await seedUser(prisma, tenantId, 'Priya Approver', financeRole);
    const versionId = await seedWorkflowVersion(prisma, tenantId, {
      roleId: financeRole,
      quorum: 'any',
    });
    const requestId = await seedRequest(prisma, tenantId, versionId, requester.id);
    const stepId = await seedStep(prisma, tenantId, requestId, financeRole, {
      dueAt: new Date(Date.now() + 3600_000),
    });

    const { mailer, sent } = collectingMailer();
    const stats = await sendPendingNotifications(prisma, mailer);
    expect(stats.stepNotices).toBeGreaterThanOrEqual(1);

    const mine = sent.filter((mail) => mail.subject.includes('Vendor payment'));
    expect(mine.map((mail) => mail.to)).toEqual([approver.email]);
    expect(mine[0]?.subject).toBe('Approval needed: Vendor payment ₹8,40,000');

    const step = await prisma.requestStep.findUniqueOrThrow({ where: { id: stepId } });
    expect(step.notifiedAt).not.toBeNull();

    // claimed — a second sweep sends nothing new for this step
    const secondSent = collectingMailer();
    await sendPendingNotifications(prisma, secondSent.mailer);
    expect(secondSent.sent.filter((mail) => mail.to === approver.email)).toHaveLength(0);
  });

  it('mails the requester when their request is decided', async () => {
    const { tenantId } = await seedTenant(prisma);
    const financeRole = await seedRole(prisma, tenantId, 'Finance');
    const requester = await seedUser(prisma, tenantId, 'Requester');
    const versionId = await seedWorkflowVersion(prisma, tenantId, {
      roleId: financeRole,
      quorum: 'any',
    });
    const requestId = await seedRequest(prisma, tenantId, versionId, requester.id, {
      status: 'approved',
      completedAt: new Date(),
    });

    const { mailer, sent } = collectingMailer();
    const stats = await sendPendingNotifications(prisma, mailer);
    expect(stats.decisionNotices).toBeGreaterThanOrEqual(1);
    const mine = sent.find((mail) => mail.to === requester.email);
    expect(mine?.subject).toBe('Request approved: Vendor payment ₹8,40,000');

    const request = await prisma.request.findUniqueOrThrow({ where: { id: requestId } });
    expect(request.completionNotifiedAt).not.toBeNull();
  });

  it('skips decision mail for machine-created requests but still claims them', async () => {
    const { tenantId } = await seedTenant(prisma);
    const financeRole = await seedRole(prisma, tenantId, 'Finance');
    await seedUser(prisma, tenantId, 'Someone');
    const versionId = await seedWorkflowVersion(prisma, tenantId, {
      roleId: financeRole,
      quorum: 'any',
    });
    // creator id is an API key uuid — resolves to no user
    const requestId = await seedRequest(prisma, tenantId, versionId, randomUUID(), {
      status: 'rejected',
      completedAt: new Date(),
    });

    const { mailer, sent } = collectingMailer();
    await sendPendingNotifications(prisma, mailer);
    expect(sent).toHaveLength(0);
    const request = await prisma.request.findUniqueOrThrow({ where: { id: requestId } });
    expect(request.completionNotifiedAt).not.toBeNull();
  });
});
