import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrisma } from '../src/db';
import { escalateOverdueSteps } from '../src/processors/escalate-steps';
import { seedRequest, seedRole, seedStep, seedTenant, seedUser, seedWorkflowVersion } from './seed';

describe('SLA escalation', () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = createPrisma();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('reassigns an overdue step to the escalation role, audits, and fires a webhook', async () => {
    const { tenantId } = await seedTenant(prisma);
    const financeRole = await seedRole(prisma, tenantId, 'Finance');
    const cfoRole = await seedRole(prisma, tenantId, 'CFO Office');
    const requester = await seedUser(prisma, tenantId, 'Requester');
    const versionId = await seedWorkflowVersion(prisma, tenantId, {
      roleId: financeRole,
      quorum: 'any',
      slaHours: 1,
      escalateToRoleId: cfoRole,
    });
    const requestId = await seedRequest(prisma, tenantId, versionId, requester.id);
    const stepId = await seedStep(prisma, tenantId, requestId, financeRole, {
      dueAt: new Date(Date.now() - 60_000),
      notifiedAt: new Date(), // was notified for the original role
    });
    await prisma.webhookEndpoint.create({
      data: { tenantId, url: 'http://127.0.0.1:9/hook', events: ['step.escalated'] },
    });

    const stats = await escalateOverdueSteps(prisma);
    expect(stats.escalated).toBeGreaterThanOrEqual(1);

    const step = await prisma.requestStep.findUniqueOrThrow({ where: { id: stepId } });
    expect(step.assignedRoleId).toBe(cfoRole);
    expect(step.escalatedToRoleId).toBe(cfoRole);
    expect(step.slaBreachedAt).not.toBeNull();
    expect(step.status).toBe('pending');
    // reset so the escalation role gets notified
    expect(step.notifiedAt).toBeNull();

    const audit = await prisma.auditEvent.findFirst({
      where: { tenantId, eventType: 'step.escalated', entityId: stepId },
    });
    expect(audit).not.toBeNull();

    const outbox = await prisma.webhookOutbox.findFirst({
      where: { tenantId, eventType: 'step.escalated' },
    });
    expect(outbox).not.toBeNull();

    // idempotent: a second sweep finds nothing to do
    const again = await escalateOverdueSteps(prisma);
    expect(again.escalated).toBe(0);
  });

  it('flags a breach without escalation role and leaves the assignment alone', async () => {
    const { tenantId } = await seedTenant(prisma);
    const financeRole = await seedRole(prisma, tenantId, 'Finance');
    const requester = await seedUser(prisma, tenantId, 'Requester');
    const versionId = await seedWorkflowVersion(prisma, tenantId, {
      roleId: financeRole,
      quorum: 'any',
      slaHours: 1,
    });
    const requestId = await seedRequest(prisma, tenantId, versionId, requester.id);
    const stepId = await seedStep(prisma, tenantId, requestId, financeRole, {
      dueAt: new Date(Date.now() - 60_000),
    });

    const stats = await escalateOverdueSteps(prisma);
    expect(stats.flagged).toBeGreaterThanOrEqual(1);

    const step = await prisma.requestStep.findUniqueOrThrow({ where: { id: stepId } });
    expect(step.assignedRoleId).toBe(financeRole);
    expect(step.escalatedToRoleId).toBeNull();
    expect(step.slaBreachedAt).not.toBeNull();

    const audit = await prisma.auditEvent.findFirst({
      where: { tenantId, eventType: 'step.sla_breached', entityId: stepId },
    });
    expect(audit).not.toBeNull();
  });

  it('ignores steps that are not yet due or not pending', async () => {
    const { tenantId } = await seedTenant(prisma);
    const financeRole = await seedRole(prisma, tenantId, 'Finance');
    const requester = await seedUser(prisma, tenantId, 'Requester');
    const versionId = await seedWorkflowVersion(prisma, tenantId, {
      roleId: financeRole,
      quorum: 'any',
      slaHours: 1,
    });
    const requestId = await seedRequest(prisma, tenantId, versionId, requester.id);
    const futureStep = await seedStep(prisma, tenantId, requestId, financeRole, {
      dueAt: new Date(Date.now() + 3600_000),
    });
    const doneStep = await seedStep(prisma, tenantId, requestId, financeRole, {
      dueAt: new Date(Date.now() - 3600_000),
      status: 'approved',
      completedAt: new Date(),
    });

    await escalateOverdueSteps(prisma);
    const future = await prisma.requestStep.findUniqueOrThrow({ where: { id: futureStep } });
    const done = await prisma.requestStep.findUniqueOrThrow({ where: { id: doneStep } });
    expect(future.slaBreachedAt).toBeNull();
    expect(done.slaBreachedAt).toBeNull();
  });
});
