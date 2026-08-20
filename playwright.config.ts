import { defineConfig } from '@playwright/test';

/**
 * Demo-recording config (e2e/demo.spec.ts): drives the full stack and records
 * a narrated walkthrough video. Requires Postgres + Redis running locally
 * (docker compose up postgres redis); the API and web dev servers are started
 * here (or reused if already running).
 *
 * Ports: 3199 (API) / 5199 (web) — deliberately off the defaults, because
 * this machine tends to have other dev servers parked on 3000/5173.
 */
export default defineConfig({
  testDir: 'e2e',
  timeout: 420_000,
  expect: { timeout: 20_000 },
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    actionTimeout: 15_000,
    baseURL: 'http://localhost:5199',
    viewport: { width: 1440, height: 900 },
    video: { mode: 'on', size: { width: 1440, height: 900 } },
    launchOptions: { slowMo: 60 },
  },
  webServer: [
    {
      command: 'pnpm --filter @approvex/api dev',
      url: 'http://localhost:3199/api/v1/health',
      reuseExistingServer: true,
      timeout: 180_000,
      env: { PORT: '3199' },
    },
    {
      command: 'pnpm --filter @approvex/web dev --port 5199 --strictPort',
      url: 'http://localhost:5199',
      reuseExistingServer: true,
      timeout: 120_000,
      env: { API_PROXY_TARGET: 'http://localhost:3199' },
    },
  ],
});
