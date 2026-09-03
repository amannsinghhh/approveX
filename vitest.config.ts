import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

import { testDbUrls } from './__tests__/api/db-urls';
import { testDbUrl } from './__tests__/worker/db-url';

const { owner, app } = testDbUrls();

/**
 * One config, three suites — they differ only in setup, not in kind:
 *
 *   shared  pure functions, no I/O, no database
 *   api     NestJS e2e against `approvex_test`     (SWC: Nest DI needs decorator metadata)
 *   worker  BullMQ processors against `approvex_worker_test`
 *
 * `fileParallelism: false` is deliberate: the api and worker suites each migrate
 * and own a database on the same Postgres, so test files must not overlap.
 */
export default defineConfig({
  test: {
    fileParallelism: false,
    projects: [
      {
        test: {
          name: 'shared',
          environment: 'node',
          include: ['__tests__/shared/**/*.spec.ts'],
        },
      },
      {
        // SWC emits the decorator metadata NestJS DI relies on (esbuild does not).
        // Cast: pnpm resolves two vite instances (web pulls one via tailwind) whose
        // plugin types are structurally identical but nominally distinct.
        plugins: [swc.vite({ module: { type: 'es6' } as never }) as never],
        test: {
          name: 'api',
          environment: 'node',
          include: ['__tests__/api/**/*.e2e-spec.ts'],
          globalSetup: ['__tests__/api/global-setup.ts'],
          env: {
            DATABASE_URL: owner,
            APP_DATABASE_URL: app,
            REDIS_URL: process.env.REDIS_URL ?? 'redis://localhost:6379',
            JWT_ACCESS_SECRET: 'test-access-secret',
            JWT_REFRESH_SECRET: 'test-refresh-secret',
          },
        },
      },
      {
        test: {
          name: 'worker',
          environment: 'node',
          include: ['__tests__/worker/**/*.spec.ts'],
          globalSetup: ['__tests__/worker/global-setup.ts'],
          env: { DATABASE_URL: testDbUrl() },
        },
      },
    ],
  },
});
