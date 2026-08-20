import { PrismaClient } from '@prisma/client';
import { env } from './env';

/**
 * The worker runs on the OWNER connection (DATABASE_URL), like migrations and
 * audit writes: its jobs are inherently cross-tenant scans (due outbox rows,
 * overdue steps) that RLS would hide. It is trusted infrastructure — every
 * query still filters by the ids it claimed, and all writes carry tenant_id.
 */
export function createPrisma(): PrismaClient {
  return new PrismaClient({ datasources: { db: { url: env.databaseUrl } } });
}
