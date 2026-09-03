import { execSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';

/**
 * Creates the target database if it is missing, then applies the migrations.
 *
 * The api and worker suites own separate databases (approvex_test /
 * approvex_worker_test) so they can run without colliding, but both are built
 * from the one schema in apps/api/prisma — it owns the RLS policies and the
 * audit-immutability triggers; the worker only consumes them.
 */
export async function prepareDatabase(ownerUrl: string): Promise<void> {
  const maintenanceUrl = new URL(ownerUrl);
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

  // Schema location comes from the "prisma" field in package.json.
  execSync('pnpm exec prisma migrate deploy', {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: ownerUrl },
    stdio: 'inherit',
  });
}
