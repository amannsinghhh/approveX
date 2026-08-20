import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';
import { testDbUrls } from './test/db-urls';

const { owner, app } = testDbUrls();

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts', 'test/**/*.e2e-spec.ts'],
    globalSetup: ['test/global-setup.ts'],
    // Specs share one test database — run files sequentially.
    fileParallelism: false,
    env: {
      DATABASE_URL: owner,
      APP_DATABASE_URL: app,
      REDIS_URL: process.env.REDIS_URL ?? 'redis://localhost:6379',
      JWT_ACCESS_SECRET: 'test-access-secret',
      JWT_REFRESH_SECRET: 'test-refresh-secret',
    },
  },
  // SWC emits the decorator metadata NestJS DI relies on (esbuild does not).
  // Cast: pnpm resolves two vite instances (web pulls one via tailwind) whose
  // Plugin types are structurally identical but nominally distinct.
  plugins: [swc.vite({ module: { type: 'es6' } }) as never],
});
