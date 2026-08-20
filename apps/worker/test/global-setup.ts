import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { testDbUrl } from './db-url';

/**
 * Creates approvex_worker_test if missing and applies the API's migrations —
 * the schema (and its RLS/trigger SQL) is owned by apps/api; the worker only
 * consumes it.
 */
export default async function globalSetup(): Promise<void> {
  const owner = testDbUrl();

  const maintenanceUrl = new URL(owner);
  const dbName = maintenanceUrl.pathname.slice(1);
  maintenanceUrl.pathname = '/postgres';

  const admin = new PrismaClient({ datasources: { db: { url: maintenanceUrl.toString() } } });
  try {
    const rows = await admin.$queryRawUnsafe<unknown[]>(
      `SELECT 1 FROM pg_database WHERE datname = '${dbName}'`,
    );
    if (rows.length === 0) {
      await admin.$executeRawUnsafe(`CREATE DATABASE "${dbName}"`);
    }
  } finally {
    await admin.$disconnect();
  }

  execSync('pnpm exec prisma migrate deploy --schema prisma/schema.prisma', {
    cwd: resolve(__dirname, '../../api'),
    env: { ...process.env, DATABASE_URL: owner },
    stdio: 'inherit',
  });
}
