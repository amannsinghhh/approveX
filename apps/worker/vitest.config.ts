import { defineConfig } from 'vitest/config';
import { testDbUrl } from './test/db-url';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.spec.ts'],
    globalSetup: ['test/global-setup.ts'],
    // Specs share one test database — run files sequentially.
    fileParallelism: false,
    env: {
      DATABASE_URL: testDbUrl(),
    },
  },
});
