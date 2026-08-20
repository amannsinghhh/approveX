# ApproveX

Business rules and approval workflows as an API. Your app calls `POST /evaluate` before taking a
business decision; ApproveX matches a rule, runs the approval workflow, and fires a signed webhook
when it completes. Every state change lands in an immutable audit log.

**Documentation**: [How it works](docs/ARCHITECTURE.md) · [Local setup](docs/SETUP.md) ·
[Production deployment](docs/DEPLOYMENT.md) · [API integration guide](docs/API-GUIDE.md) ·
[Product guide & pitch](docs/PRODUCT.md) · Swagger at `/api/docs`

## Stack

pnpm monorepo — NestJS API (`apps/api`), React + Vite dashboard (`apps/web`), BullMQ worker
(`apps/worker`), shared types + rule evaluator (`packages/shared`). PostgreSQL 16, Redis, Prisma.

## Getting started

```bash
# Everything (postgres, redis, api, worker, web):
docker compose up

# Or locally:
pnpm install
cp .env.example .env
pnpm --filter @approvex/shared build
pnpm dev
```

- API: http://localhost:3000/api/v1/health · OpenAPI docs: http://localhost:3000/api/docs
- Web: http://localhost:5173

## Development

```bash
pnpm build        # build all packages (topological order)
pnpm lint         # eslint
pnpm typecheck    # tsc --noEmit everywhere
pnpm test         # vitest everywhere
```

CI (GitHub Actions) runs build, lint, format check, typecheck, tests, `prisma validate`, and a
`prisma migrate diff` drift check on every push and PR.

## Security model (Phase 1)

- **Row-level security**: the API's domain queries run as the non-owner Postgres role
  `approvex_app`; every tenant table has an RLS policy keyed to `app.tenant_id`. No tenant
  context ⇒ zero rows. Cross-tenant lookups return 404.
- **Auth**: email/password → JWT access token (15m) + rotating refresh token (7d, revocable).
- **RBAC**: roles per tenant, global permission catalog (`rule:create`, `member:manage`, ...),
  enforced by `@RequirePermissions(...)` guards. Signup creates a system `Admin` role.
- **Audit**: append-only `audit_events`; a Postgres trigger rejects UPDATE/DELETE/TRUNCATE even
  for the table owner. Every mutating endpoint is logged automatically; secrets are redacted.

## Rule engine (Phase 2)

- **Condition ASTs** — AND/OR/NOT (max depth 10) over 15 comparison operators including IN,
  BETWEEN, CONTAINS, and MATCHES_REGEX (ReDoS-screened + hard worker-thread timeout). Dot paths
  (`vendor.country`, `items[0].category`) supported. The evaluator is a pure function in
  `packages/shared` with exhaustive unit tests.
- **Explicit typing** — a per-tenant field registry (`/fields`) declares types; numeric strings
  compare numerically only for registered numeric fields. Type mismatches and missing fields are
  false (never 500) and recorded in the evaluation trace.
- **Immutable versions** — publishing freezes a rule version (DB trigger); edits create the next
  draft. Running requests stay pinned (Phase 4).
- **`POST /evaluate` (dry_run)** — returns matched rule, priority-based conflict resolution
  (priority → specificity → age) with the full ranking, and a per-node trace. Published rule sets
  are cached in Redis per tenant and invalidated on publish.

## Dashboard (Phase 3)

- **Design system** — ledger + stamp identity: tokens in `packages/shared/tokens.css`, Schibsted
  Grotesk UI type, IBM Plex Mono for every ID/amount/timestamp, ink-stamp status chips.
- **Rule Builder** — visual nested condition builder (All/Any groups, NOT, typed value inputs
  driven by the field registry), live JSON preview, and a Test tab that runs the draft against the
  same evaluator the API uses, entirely client-side.
- **Decision table editor** — spreadsheet-style grid with the shared cell grammar
  (`*`, `> 500000`, `50000..500000`, `Finance, Procurement`), live row-fires stamps, hit-policy
  toggle, publish flow.
- **Sandbox** — server-side dry runs rendered as a mono receipt: matched rule, ✓/✗ per condition
  with actuals, and the full conflict-resolution ranking.

## Workflow engine (Phase 4)

- **`POST /evaluate mode=execute`** — matches a rule, resolves its bound workflow's current
  published version, pins it to the request forever, and opens the first approval steps.
  `Idempotency-Key` replays return the original response.
- **Graphs** — start/approval/parallel/auto_approve/auto_reject/condition_branch nodes; forks,
  AND-joins, conditional routing. Validated on publish: cycles, orphans, unknown roles, and
  join-deadlock shapes are rejected with pointed errors (`POST /workflows/validate` for builders).
- **Maker-checker** — requesters can never approve their own request, even via role membership or
  delegation; a request whose only possible approver is the requester is blocked at creation with
  a clear 422 (or auto-escalated when the node has an escalation role).
- **Approvals** — any / all / n-of-m quorums, comment-required rejections, two rejection policies
  (kill or return-to-previous-step), ad-hoc step delegation, out-of-office delegation windows
  (both identities audited), cancellation, `GET /inbox`.
- **Concurrency** — engine transitions lock the request row then the step row; simultaneous
  approvals resolve to exactly one decider and a 409.

## Dashboard, continued (Phase 5)

- **Approval Inbox** — two-pane triage: cards with requester, Indian-formatted amounts, SLA
  meters that go amber/red as due dates approach, keyboard J/K/A/R, and an ALL CLEAR stamp when
  the queue is empty. The detail pane shows the payload ledger, "Why am I seeing this?"
  (matched rule → workflow), the audit timeline, and Reject/Delegate/Approve with
  comment-required rejection.
- **Requests explorer** — the ledger: ID, title, context, current step, stamp, age; filters
  persist in the URL; rows open a 560px drawer (`?request=` deep links); the empty state is a
  copyable curl snippet.
- **Workflow Builder** — React Flow canvas with color-coded 220px node cards, add-node palette,
  role/quorum/SLA/escalation config panel, edge conditions, server-side Validate with offending
  nodes badged red, version bar with read-only history + restore-as-draft.

## Webhooks, timers, keys (Phase 6)

- **Transactional outbox** — every lifecycle event (`request.created`, `request.approved`,
  `request.rejected`, `request.cancelled`, `step.escalated`, `workflow.webhook_call`, `ping`) is
  written to `webhook_outbox` in the SAME transaction as the state change. The worker delivers
  with retries (1m, 5m, 30m, 2h, 12h), then dead-letters; the dashboard shows the per-endpoint
  delivery log. `webhook_call` workflow nodes fire for real (inline URL or subscribed endpoints).
- **Signatures** — payloads are HMAC-SHA256 signed with a per-tenant secret
  (`GET /webhooks/secret`, rotatable). Verify before trusting:

  ```ts
  import { createHmac } from 'node:crypto';

  function verify(secret: string, rawBody: string, header: string): boolean {
    const match = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(header); // X-ApproveX-Signature
    if (!match) return false;
    if (Math.abs(Date.now() / 1000 - Number(match[1])) > 300) return false; // replay window
    const mac = createHmac('sha256', secret).update(`${match[1]}.${rawBody}`).digest('hex');
    return mac === match[2];
  }
  ```

- **Escalation timers** — a pending step past its SLA is reassigned to the node's escalation role
  (audit event + webhook + fresh notifications) or flagged `step.sla_breached` when there is none.
- **Notifications** — approvers are emailed when a step opens (or escalates to them), requesters
  when a decision lands. Resend via `RESEND_API_KEY`; log-only without it.
- **API keys** — `Authorization: Bearer ax_...` with scopes (`evaluate`, `request:create`,
  `request:read`). Plaintext shown once; sha256 stored; revocation is immediate. Requests created
  by a key carry it as creator (maker-checker unaffected).
- **Rate limiting** — per-tenant sliding window (default 300/min, `RATE_LIMIT_RPM`) on
  `POST /evaluate` and `POST /requests`; 429 + `Retry-After`. Redis down ⇒ fail open.
- **SSO** — Google + Microsoft OIDC login for existing users (never auto-provisions), enabled by
  setting the provider's client id/secret env vars.

## Hardening & launch (Phase 7)

- **First-run wizard** — signup lands on `/welcome`: pick a template (payments, expenses, vendor
  onboarding, discounts, POs) and watch roles, fields, rule, and workflow assemble through the
  real APIs, then fire a live evaluation and invite approvers (`/accept-invite` links).
- **Analytics** — volume, approval rate, median time-to-decision, SLA breaches/escalations, top
  rules, contexts, webhook health (`GET /analytics/summary`, hand-rolled SVG charts).
- **Cmd+K palette** — jump anywhere, create anything, find any request from the keyboard.
- **Performance** — k6 verified p95 **45.8ms** over 1,000 published rules (target < 50ms):
  ranking uses a trace-free evaluator fast path (winner re-traced), `matchesConsidered` capped
  at 25 (`rulesConsidered` carries the total). Seed + script in `scripts/`.
- **Deploy** — `docker-compose.prod.yml` + `Caddyfile` (automatic HTTPS, SPA + `/api` proxy),
  `Dockerfile.prod`, nightly `scripts/backup.sh` (pg_dump, 14 kept), env-gated Sentry.

## Status

All phases (0–7) complete: the MVP is feature-complete and launch-ready. See `CLAUDE.md` for the
phase log and roadmap candidates.
