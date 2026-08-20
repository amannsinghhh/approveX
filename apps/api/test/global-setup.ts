import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { testDbUrls } from './db-urls';

/** Creates the approvex_test database if missing and applies all migrations. */
export default async function globalSetup(): Promise<void> {
  const { owner } = testDbUrls();

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

  execSync('pnpm exec prisma migrate deploy', {
    cwd: resolve(__dirname, '..'),
    env: { ...process.env, DATABASE_URL: owner },
    stdio: 'inherit',
  });
}
