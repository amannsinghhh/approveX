/**
 * Load-test seeder (Phase 7): a dedicated tenant with 1,000 PUBLISHED rules in
 * one context, inserted directly (owner connection — the API would need 2,000
 * calls). Prints the credentials the k6 script logs in with.
 *
 *   pnpm exec tsx scripts/seed-load.ts
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';

const RULE_COUNT = 1000;
const CONTEXT = 'LOAD_TEST';
const EMAIL = 'loadtest@approvex.local';
const PASSWORD = 'load-test-password-1';

async function main(): Promise<void> {
  const prisma = new PrismaClient();

  const existing = await prisma.user.findUnique({ where: { email: EMAIL } });
  if (existing) {
    const count = await prisma.rule.count({
      where: { tenantId: existing.tenantId, context: CONTEXT },
    });
    console.log(`Load tenant already seeded (${count} rules).`);
    console.log(`email=${EMAIL} password=${PASSWORD} context=${CONTEXT}`);
    await prisma.$disconnect();
    return;
  }

  const tenant = await prisma.tenant.create({
    data: {
      name: 'Load Test Tenant',
      slug: `load-test-${randomUUID().slice(0, 8)}`,
      webhookSecret: randomBytes(32).toString('hex'),
    },
  });
  await prisma.user.create({
    data: {
      tenantId: tenant.id,
      email: EMAIL,
      name: 'Load Tester',
      passwordHash: await argon2.hash(PASSWORD),
      status: 'active',
    },
  });
  await prisma.fieldDefinition.createMany({
    data: [
      { tenantId: tenant.id, name: 'amount', type: 'number' },
      { tenantId: tenant.id, name: 'category', type: 'string' },
    ],
  });

  // 1,000 published rules, distinct thresholds/categories so the evaluator
  // does real work; priorities spread so conflict resolution ranks a real set.
  const now = new Date();
  for (let batch = 0; batch < RULE_COUNT; batch += 250) {
    const rules = Array.from({ length: Math.min(250, RULE_COUNT - batch) }, (_, i) => {
      const n = batch + i;
      return {
        id: randomUUID(),
        tenantId: tenant.id,
        name: `Load rule ${String(n).padStart(4, '0')}`,
        context: CONTEXT,
        status: 'published' as const,
        currentVersion: 1,
      };
    });
    await prisma.rule.createMany({ data: rules });
    await prisma.ruleVersion.createMany({
      data: rules.map((rule, i) => {
        const n = batch + i;
        return {
          tenantId: tenant.id,
          ruleId: rule.id,
          version: 1,
          priority: 100 + (n % 50),
          publishedAt: now,
          conditionAst: {
            operator: 'AND',
            children: [
              { field: 'amount', operator: '>', value: n * 1000 },
              { field: 'category', operator: '==', value: `cat_${n % 25}` },
            ],
          },
        };
      }),
    });
    console.log(`seeded ${batch + rules.length}/${RULE_COUNT}`);
  }

  console.log('Done.');
  console.log(`email=${EMAIL} password=${PASSWORD} context=${CONTEXT}`);
  await prisma.$disconnect();
}

void main();
