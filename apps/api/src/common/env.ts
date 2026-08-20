import { readFileSync } from 'node:fs';

// Optional .env for local dev; docker compose, CI, and the test runner inject
// real env vars, which always win — a value already present is never replaced.
try {
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    const key = match?.[1];
    if (key && process.env[key] === undefined) {
      process.env[key] = (match[2] ?? '').replace(/^(["'])(.*)\1$/, '$2');
    }
  }
} catch {
  // no .env present — fine
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export const env = {
  get jwtAccessSecret(): string {
    return required('JWT_ACCESS_SECRET');
  },
  get jwtRefreshSecret(): string {
    return required('JWT_REFRESH_SECRET');
  },
  /** JWT_ACCESS_TTL accepts 900, 900s, 15m, 1h, 7d. */
  get accessTtlSeconds(): number {
    const raw = process.env.JWT_ACCESS_TTL ?? '15m';
    const match = raw.match(/^(\d+)([smhd]?)$/);
    if (!match) throw new Error(`Invalid JWT_ACCESS_TTL: ${raw}`);
    const multiplier = { '': 1, s: 1, m: 60, h: 3600, d: 86400 }[match[2] ?? ''] ?? 1;
    return Number(match[1]) * multiplier;
  },
  refreshTtlDays: 7,
  /** Where OIDC callbacks land (must match the provider console). */
  get apiPublicUrl(): string {
    return (process.env.API_PUBLIC_URL ?? 'http://localhost:3000').replace(/\/$/, '');
  },
  /** Where the browser is sent after an SSO login. */
  get webAppUrl(): string {
    return (process.env.WEB_APP_URL ?? 'http://localhost:5199').replace(/\/$/, '');
  },
};
