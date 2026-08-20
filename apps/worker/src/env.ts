import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Optional .env for local dev (same contract as the API: real env vars always
// win). The worker shares the API's .env so `pnpm dev` needs one file, not two.
for (const candidate of ['.env', resolve(__dirname, '../../api/.env')]) {
  try {
    for (const line of readFileSync(candidate, 'utf8').split('\n')) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      const key = match?.[1];
      if (key && process.env[key] === undefined) {
        process.env[key] = (match[2] ?? '').replace(/^(["'])(.*)\1$/, '$2');
      }
    }
  } catch {
    // no .env at this path — fine
  }
}

export const env = {
  get databaseUrl(): string {
    const value = process.env.DATABASE_URL;
    if (!value) throw new Error('Missing required environment variable: DATABASE_URL');
    return value;
  },
  get redisUrl(): string {
    return process.env.REDIS_URL ?? 'redis://localhost:6379';
  },
  /**
   * Where the browser lands for no-login approval links. Same var and default
   * as the API's webAppUrl so the /approve/:token link the worker mints resolves
   * to the same frontend the API serves the landing page for.
   */
  get webAppUrl(): string {
    return (process.env.WEB_APP_URL ?? 'http://localhost:5199').replace(/\/$/, '');
  },
};
