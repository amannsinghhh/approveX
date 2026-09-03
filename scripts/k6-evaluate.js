/**
 * k6 load test (Phase 7 target: p95 < 50ms on POST /evaluate over 1,000
 * published rules). Seed first, disable throttling for the run:
 *
 *   pnpm exec tsx scripts/seed-load.ts
 *   RATE_LIMIT_RPM=10000000 node apps/api/dist/main.js   # or restart dev API
 *   k6 run scripts/k6-evaluate.js
 */
/* global __ENV */
import http from 'k6/http';
import { check } from 'k6';

const BASE = __ENV.BASE_URL || 'http://localhost:3000/api/v1';

export const options = {
  scenarios: {
    evaluate: {
      executor: 'constant-vus',
      vus: 20,
      duration: '30s',
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<50'],
    http_req_failed: ['rate<0.01'],
  },
};

export function setup() {
  const login = http.post(
    `${BASE}/auth/login`,
    JSON.stringify({ email: 'loadtest@approvex.local', password: 'load-test-password-1' }),
    { headers: { 'Content-Type': 'application/json' } },
  );
  if (login.status !== 200) {
    throw new Error(`login failed (${login.status}) — run scripts/seed-load.ts first`);
  }
  return { token: login.json('accessToken') };
}

export default function (data) {
  const amount = Math.floor(Math.random() * 1_000_000);
  const category = `cat_${Math.floor(Math.random() * 25)}`;
  const res = http.post(
    `${BASE}/evaluate`,
    JSON.stringify({ context: 'LOAD_TEST', data: { amount, category }, mode: 'dry_run' }),
    {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${data.token}`,
      },
    },
  );
  check(res, { 'status 200': (r) => r.status === 200 });
}
