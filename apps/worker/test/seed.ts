import { randomBytes, randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';

/** Minimal direct-to-DB fixtures for processor tests (owner connection). */

export interface SeededTenant {
  tenantId: string;
  webhookSecret: string;
}

export async function seedTenant(prisma: PrismaClient): Promise<SeededTenant> {
  const webhookSecret = randomBytes(32).toString('hex');
  const tenant = await prisma.tenant.create({
    data: { name: `Worker Test ${randomUUID().slice(0, 8)}`, slug: randomUUID(), webhookSecret },
  });
  return { tenantId: tenant.id, webhookSecret };
}

export async function seedUser(
  prisma: PrismaClient,
  tenantId: string,
  name: string,
  roleId?: string,
): Promise<{ id: string; email: string }> {
  const user = await prisma.user.create({
    data: {
      tenantId,
      email: `${randomUUID()}@worker.test`,
      passwordHash: 'x',
      name,
      status: 'active',
      ...(roleId ? { userRoles: { create: { roleId, tenantId } } } : {}),
    },
  });
  return { id: user.id, email: user.email };
}

export async function seedRole(
  prisma: PrismaClient,
  tenantId: string,
  name: string,
): Promise<string> {
  const role = await prisma.role.create({ data: { tenantId, name } });
  return role.id;
}

/** A published single-approval workflow version pinned by test requests. */
export async function seedWorkflowVersion(
  prisma: PrismaClient,
  tenantId: string,
  approvalConfig: Record<string, unknown>,
): Promise<string> {
  const workflow = await prisma.workflow.create({
    data: { tenantId, name: `wf-${randomUUID().slice(0, 8)}`, status: 'published' },
  });
  const graph = {
    nodes: [
      { id: 'start', type: 'start' },
      { id: 'approve_step', type: 'approval', label: 'Approval', config: approvalConfig },
    ],
    edges: [{ from: 'start', to: 'approve_step' }],
  };
  const version = await prisma.workflowVersion.create({
    data: {
      tenantId,
      workflowId: workflow.id,
      version: 1,
      graph: graph as unknown as Prisma.InputJsonValue,
      publishedAt: new Date(),
    },
  });
  return version.id;
}

export async function seedRequest(
  prisma: PrismaClient,
  tenantId: string,
  workflowVersionId: string,
  createdById: string,
  overrides: Partial<Prisma.RequestUncheckedCreateInput> = {},
): Promise<string> {
  const request = await prisma.request.create({
    data: {
      tenantId,
      workflowVersionId,
      createdById,
      title: 'Vendor payment ₹8,40,000',
      context: 'PAYMENTS',
      payload: { amount: 840000 },
      engineState: { completed: ['start'], delivered: ['start->approve_step'] },
      ...overrides,
    },
  });
  return request.id;
}

export async function seedStep(
  prisma: PrismaClient,
  tenantId: string,
  requestId: string,
  assignedRoleId: string,
  overrides: Partial<Prisma.RequestStepUncheckedCreateInput> = {},
): Promise<string> {
  const step = await prisma.requestStep.create({
    data: { tenantId, requestId, nodeId: 'approve_step', assignedRoleId, ...overrides },
  });
  return step.id;
}
