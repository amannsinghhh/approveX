# Local development setup

## Prerequisites

- Node ≥ 20 and pnpm 9 (`corepack enable pnpm`)
- PostgreSQL 16 and Redis 7 — either native or via Docker
- (optional) `k6` for the load test, Docker for the containerised path

## Path A — everything in Docker

```bash
cp .env.example .env
docker compose up
```

- API: http://localhost:3000/api/v1/health · Swagger: http://localhost:3000/api/docs
- Web: http://localhost:5173
- Worker: check `docker compose logs -f worker` for the `started (bullmq)` line

Migrations run automatically when the api container starts.

## Path B — native (fastest feedback)

```bash
pnpm install
cp .env.example .env && cp .env.example apps/api/.env

# start postgres + redis however you like, e.g.:
#   macOS/Homebrew: /opt/homebrew/opt/postgresql@16/bin/pg_ctl -D /opt/homebrew/var/postgresql@16 start
#   or just: docker compose up postgres redis

pnpm --filter @approvex/shared build          # the api/web/worker import its dist
pnpm --filter @approvex/api exec prisma migrate dev   # creates schema + approvex_app role + RLS

pnpm --filter @approvex/api dev               # API on :3000
pnpm --filter @approvex/worker dev            # worker (reads apps/api/.env too)
pnpm --filter @approvex/web dev --port 5199 --strictPort   # dashboard on :5199
```

Sign up at http://localhost:5199/signup — the first-run wizard takes the tenant from zero to a
working approval flow with a template.

> The web dev server proxies `/api` to `localhost:3000` (see `apps/web/vite.config.ts`).
> Port 5199 is deliberate: 5173/5174 tend to be occupied by other Vite apps.

## Everyday commands

```bash
pnpm build        # all packages, topological order
pnpm lint         # eslint (flat config, type-aware)
pnpm typecheck    # tsc --noEmit everywhere
pnpm test         # vitest everywhere — see below
pnpm format       # prettier --write
```

## Tests

| Suite                                                                       | Where             | Needs                                                                                           |
| --------------------------------------------------------------------------- | ----------------- | ----------------------------------------------------------------------------------------------- |
| Rule evaluator, decision tables, workflow validation, webhook signing (219) | `packages/shared` | nothing                                                                                         |
| API e2e — auth, RLS, engines, webhooks, keys, rate limit (96)               | `apps/api`        | Postgres (creates/migrates `approvex_test` itself); Redis optional (rate-limit spec self-skips) |
| Worker — delivery, escalation, notifications (10)                           | `apps/worker`     | Postgres (own DB `approvex_worker_test`)                                                        |

Run one file: `pnpm --filter @approvex/api exec vitest run test/phase6.e2e-spec.ts`

## Load test (Phase 7 target: p95 < 50ms over 1k rules)

```bash
pnpm --filter @approvex/api exec tsx ../../scripts/seed-load.ts   # 1,000 published rules
RATE_LIMIT_RPM=100000000 pnpm --filter @approvex/api start        # throttling off for the run
k6 run scripts/k6-evaluate.js
```

Recorded result: p95 45.8ms · avg 36.9ms · ~540 req/s · 0 failures (20 VUs, 30s, M-series laptop).

## Gotchas worth knowing

- **Never `import type` a class that NestJS injects** — decorator metadata needs the runtime
  import. The eslint rule that would "fix" this is disabled on purpose.
- `@approvex/shared` is CJS behind a workspace symlink; the web app needs it in
  `optimizeDeps.include` and `build.commonjsOptions.include` (already configured) or named
  imports break.
- API tests compile with SWC (decorator metadata); config in `apps/api/vitest.config.ts`.
- Two `.env` files locally (root for compose, `apps/api/.env` for native dev) — same contents.
