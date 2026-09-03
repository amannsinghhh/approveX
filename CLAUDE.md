# ApproveX — CLAUDE.md

Multi-tenant B2B SaaS: companies define business rules and approval workflows without code and
expose them to their existing systems via REST API + webhooks. Core loop: `POST /evaluate` → rule
engine matches (JSON condition AST or decision table) → workflow engine instantiates approval
workflow → approvers act via API/dashboard → signed webhook fires back → everything lands in an
immutable audit log. Positioning: "You do not need to change your existing application. Just call
our API before taking a business decision."

## Commands

- `pnpm install` — one package, one node_modules (pnpm 9, Node ≥ 20)
- `pnpm build | lint | typecheck | test` — whole repo
- `pnpm dev:api` — API on :3000 (Swagger at /api/docs)
- `docker compose up` — postgres, redis, api, worker, web
- Tests: all under `__tests__/{api,worker,shared}`, one root `vitest.config.ts` with three
  projects. The api project uses SWC (Nest DI needs decorator metadata).
- API tests need Postgres 16; they create/migrate their own `approvex_test` DB
  (`__tests__/api/global-setup.ts`).
  Local Postgres: `/opt/homebrew/opt/postgresql@16/bin/pg_ctl -D /opt/homebrew/var/postgresql@16 start`
- Never `import type` a class that is injected via a Nest constructor — decorator metadata needs
  the runtime import (the eslint consistent-type-imports rule is off for this reason).

## Architecture decisions (Phase 1)

- Two DB connections: `DATABASE_URL` (owner; migrations, auth bootstrap, audit writes — bypasses
  RLS) and `APP_DATABASE_URL` (role `approvex_app`, non-owner — RLS always enforced). Tenant-scoped
  queries must use `TenantPrismaService.forTenant(tenantId)` / `.transactionForTenant(...)`.
- RLS policies key off `current_setting('app.tenant_id')`; unset ⇒ NULL ⇒ zero rows (fail closed).
- Emails are globally unique in MVP (one tenant per user); multi-tenant membership is V2.
- Refresh tokens: JWT with jti; sha256(jti) stored in refresh_tokens; rotated on every refresh.
- Guards: global JwtAuthGuard (@Public() to skip) then PermissionsGuard (@RequirePermissions(...)).
  Global AuditInterceptor logs every mutating endpoint; auth flows write their own richer events.

## Architecture decisions (Phase 2)

- Rule evaluator is pure and lives in `shared/src/rule-evaluator/`. Missing field ⇒
  comparison false + `missing_field` trace note (IS_NULL/IS_NOT_NULL treat missing as null).
  No silent coercion: registry-declared types coerce explicitly; type mismatch ⇒ false (even for
  `!=`) + `type_mismatch` note. Logical nodes never short-circuit (full trace). Depth cap 10,
  node cap 200.
- MATCHES_REGEX safety: heuristic screen (nested quantifiers, backrefs, length) at authoring AND
  eval time, plus a hard timeout via a persistent worker thread + Atomics.wait — vm timeouts do
  NOT interrupt V8 regex, don't try. Loaded via process.getBuiltinModule (ESM/CJS/browser-safe).
- Rule lifecycle: rule row (status draft|published|archived) + rule_versions. Draft head
  (published_at null) is editable via PUT /rules/:id/draft; editing a published head creates
  v(n+1). Publish sets published_at + rule.currentVersion; a DB trigger makes published versions
  immutable even for the owner. Published rules archive (never hard-delete).
- Contexts are SCREAMING_SNAKE_CASE strings on the rule row; /evaluate only considers published
  rules of the given context within their effective window.
- Conflict resolution implemented in EvaluateService.dryRun: priority asc → conditionCount desc →
  rule createdAt asc. `matchesConsidered` in the response shows the full ranking.
- Redis caches per tenant: `rules:{tenantId}:{context}` and `fields:{tenantId}`, TTL 1h,
  invalidated on publish/archive/field changes. Redis down ⇒ silent DB fallback (RedisService
  fails fast, callers never error).

## Architecture decisions (Phase 3)

- Decision tables compile to the SAME condition AST/evaluator (shared/src/decision-table).
  Cell grammar: `*` any · `> 500000` · `50000..500000` (BETWEEN) · `a, b` (IN) · quoted "42" stays
  string. Row outputs are opaque `{ workflow: KEY }` objects until Phase 4 binds workflows.
  Same draft/publish/immutability lifecycle as rules (shared DB trigger function).
- Web app: Tailwind v4 (@tailwindcss/vite); design tokens in shared/tokens.css mapped via
  @theme in apps/web/src/app.css. Fonts: Schibsted Grotesk (UI) + IBM Plex Mono (data) via Google
  Fonts. Signature components in src/components: StampChip (uppercase mono, -1° rotation),
  LedgerTable, TraceReceipt, EmptyState, MonoId, condition-builder. Primitives hand-styled in
  components/ui.tsx (shadcn/radix deliberately deferred to Phase 5 when dialogs/drawers arrive).
- Rule Builder Test tab and decision-table editor evaluate CLIENT-SIDE with the shared evaluator
  (drafts aren't published so /evaluate can't see them). In the browser the regex worker is
  unavailable → heuristic-screen-only fallback (server still enforces the hard timeout).
- shared/ is imported as plain TypeScript source via relative paths (no package boundary), so
  vite compiles it like any other source file — the old CJS/optimizeDeps workarounds are gone.
- Local dev gotcha: the user runs other vite apps bound to [::1]:5173/5174 — start the web app on
  a free port, e.g. `pnpm dev:web --port 5199 --strictPort`.

## Architecture decisions (Phase 4)

- Graph validation lives in shared/src/workflow (builder UI reuses it). Semantics:
  multiple outgoing edges = fork (all activate); a node with multiple incoming edges is an
  AND-join (activates when every inbound edge delivered); condition_branch picks the first
  matching conditional edge else the default (dead end ⇒ request rejected + audit). Validation
  forbids condition_branch feeding a join (exclusive paths would deadlock it).
- Engine state persists on requests.engine_state ({completed[], delivered[]} over the PINNED
  workflow_version graph). All transitions run in transactionForTenant with row locks: request
  FIRST, then step (SELECT ... FOR UPDATE) — double-submits get 409 deterministically.
- Maker-checker: eligibleMembers() = active role members minus request creator, everywhere.
  Preflight at instantiation walks ALL approval nodes; a node whose only member is the creator
  422s BEFORE any row is created (unless escalateToRoleId has members — then the step is
  assigned to the escalation role at activation with a step.escalated audit event).
- Quorum evaluated per approve action: any=1, all=current eligible count, {n} clamped to eligible.
- Eligibility to act = role member ∪ ad-hoc step delegate (step_actions.target_user_id) ∪ OOO
  delegate (delegations window covering now, acting on_behalf_of a member — both identities
  recorded on the step_action).
- reject_returns_to_previous_step: only valid on linear graphs (validated); rewinds engine state,
  marks the old approved step "superseded", reopens the previous node.
- Idempotency: requests unique (tenant_id, idempotency_key); the ORIGINAL response is snapshotted
  in requests.initial_response and replayed verbatim; P2002 race → fetch + replay.
- wait nodes pass through with a workflow.node_passthrough audit event until Phase 7
  (webhook_call executes for real since Phase 6).
- reject_request no-match policy responds status=rejected WITHOUT creating a request row
  (workflow_version_id is NOT NULL; revisit if a persisted rejection trail is needed).
- Rule→workflow binding: rule_workflow_bindings keyed by rule_version_id, managed via
  PUT /rules/:id/binding (binds the head version). NOTE: publishing a new rule version does NOT
  auto-carry the binding — rebind after publish (candidate improvement).

## Architecture decisions (Phase 5)

- Workflow Builder uses @xyflow/react v12; node positions persist inside the graph JSON
  (node.position — engine + validator ignore it). Graphs without positions get a BFS column
  auto-layout. Canonical graph JSON is derived from canvas state in buildGraph().
- GET /requests/:id (engine.describe) is UI-enriched: matchedRule {name,version}, workflowName,
  createdBy, actor names on every step action. GET /inbox items carry request.createdByName.
- RequestDetail is the one shared drawer (Inbox two-pane + Requests explorer 560px overlay,
  deep-linked via ?request=). Delegate/OOO users won't appear in eligibleUsers, so the UI offers
  the first pending step and lets the API decide (403 if truly ineligible).
- Inbox keyboard: J/K select, A clicks [data-inbox-approve], R pre-opens the reject comment.
  Reject confirm stays disabled until a comment exists (spec §5.1).

## Architecture decisions (Phase 6)

- Transactional outbox: OutboxService.enqueue runs INSIDE the engine/cancel transactions (fan-out
  to enabled endpoints; empty events[] = all events). webhook_call nodes enqueue with an inline
  URL (outbox.endpoint_id null) and complete immediately — fire-and-forget by design.
- Worker (apps/worker, plain TS + BullMQ): repeatable jobs deliver-webhooks@10s /
  escalate-steps@30s / send-notifications@20s. Claiming = one UPDATE with a FOR UPDATE SKIP
  LOCKED subquery + 5-min locked_at lease (crash recovery); HTTP happens OUTSIDE any DB tx.
  Redis down at boot ⇒ setInterval fallback. Worker uses the OWNER connection (cross-tenant
  scans; RLS would hide rows) — every query filters explicitly.
- Worker reuses the API's generated Prisma client via pnpm store dedupe (same exact
  @prisma/client version in both packages). Worker tests own approvex_worker_test and run
  `prisma migrate deploy` against apps/api's schema (test/global-setup.ts).
- Signature: X-ApproveX-Signature `t=<unix>,v1=<hmac hex of "t.body">`, per-tenant secret
  (rotate via POST /webhooks/secret/rotate). Sign/verify/backoff live in
  shared/src/webhooks (getBuiltinModule('node:crypto') — browser-import-safe).
- SLA escalation REASSIGNS assigned_role_id to escalateToRoleId (inbox/eligibility/quorum follow),
  sets escalated_to_role_id + sla_breached_at (the once-only marker), resets notified_at. No
  escalation role ⇒ step.sla_breached audit event only.
- Notifications: request_steps.notified_at + requests.completion_notified_at are claim stamps
  (claim BEFORE send — at-most-once). Resend HTTP API via fetch when RESEND_API_KEY is set,
  log-only otherwise. API-key creators get no decision mail.
- API keys: `ax_<48hex>`, sha256 in api_keys.key_hash, plaintext returned once. JwtAuthGuard
  branches on the ax_ prefix (owner-connection lookup); PermissionsGuard requires @ApiKeyScopes
  on the route (fail closed — human-only endpoints 403 for keys). Key principal's userId = the
  key's uuid → maker-checker/creator attribution just work; describe/inbox fall back to
  "<name> (API key)". last_used_at throttled to 1 write/min.
- Rate limit: RateLimitGuard (3rd global guard) on @RateLimited routes (/evaluate, POST
  /requests). Redis ZSET sliding window keyed rl:{tenantId}, RATE_LIMIT_RPM (default 300; read
  per request so tests can flip it), 429 + Retry-After; Redis errors fail OPEN.
- OIDC (Google/Microsoft): env-gated (OIDC_<P>_CLIENT_ID/SECRET), authorization-code flow, state
  = 10-min JWT carrying the nonce. id_token verified manually with node:crypto against the
  provider JWKS (jose v5+ is ESM-only, API is CJS — don't add it). SSO never provisions: email
  must match an existing active user. Tokens land on {WEB_APP_URL}/auth/callback in the URL
  FRAGMENT. Microsoft 'common' issuer validated by prefix.
- apikey:manage permission added to the catalog; the RLS migration backfills existing system
  Admin roles (signup bootstrap grants the whole catalog to new tenants).

## Architecture decisions (Phase 7)

- Evaluate hardening for the p95<50ms/1k-rules target: matchesConsidered capped at 25 (+
  rulesConsidered total) — uncapped was ~145KB/response; evaluator gained collectTrace:false
  (no trace allocation, short-circuit ALLOWED — verdicts identical, evaluation is pure); match()
  ranks trace-free and re-traces only the winner. k6 result: p95 45.8ms @ 20 VUs (scripts/).
- Analytics: GET /analytics/summary — raw SQL must go through transactionForTenant (forTenant's
  extension wraps model ops only, NOT $queryRaw → no RLS context).
- Onboarding wizard (/welcome, signup lands there): templates in apps/web/src/lib/templates.ts
  create roles/fields/rule/workflow/binding through the NORMAL APIs client-side (idempotent-ish:
  409 → fetch-and-reuse). /accept-invite page closes the invitation loop (accept → auto-login).
- CommandPalette (Cmd+K) mounted in AppShell; searches static nav/actions + recent requests.
- Prod deploy runs on Dokploy: Dockerfile.prod builds the api + worker targets, Dockerfile.web
  serves the SPA via nginx, and Dokploy's Traefik terminates TLS and routes to `web`.
  Dev compose uses the single Dockerfile.dev (api/web/worker targets — one install, shared build).
  scripts/backup.sh pg_dump rotate 14. Sentry init in api main.ts only when SENTRY_DSN set
  (v10 SDK: init() only, no Nest handler wiring).
- Docs live in docs/ (ARCHITECTURE, SETUP, DEPLOYMENT, API-GUIDE, PRODUCT — the last one holds
  the pitch + demo script).

## Repo layout

Single pnpm package — one `package.json`, one `node_modules`, no workspaces:
`apps/api` (NestJS modular monolith), `apps/web` (React + Vite dashboard),
`apps/worker` (BullMQ processors), `shared` (types + the rule evaluator — API and
sandbox UI import it by relative path so both evaluate rules with identical code),
`__tests__` (all tests: api / worker / shared).

## Non-negotiable engineering principles

If any instruction conflicts with these, these win.

1. **Multi-tenancy from day 1.** Every domain table has `tenant_id`. Postgres Row-Level Security
   _in addition to_ application-level scoping. A missing tenant filter must fail closed, never leak.
   Cross-tenant fetch by UUID returns **404**, not 403 (don't confirm existence).
2. **Rules and workflows are immutable once published.** Editing creates a new version. A running
   workflow instance is permanently pinned to the rule version and workflow version it started
   with. Never mutate a published version in place.
3. **Every state change is an event.** Append-only `audit_events` table. A Postgres trigger raises
   an exception on UPDATE or DELETE of audit rows.
4. **Idempotency.** `POST /evaluate` and `POST /requests` accept an `Idempotency-Key` header. Same
   key + same tenant = return the original response; never create a duplicate.
5. **Webhooks use the transactional outbox pattern.** Never call an external URL inside a DB
   transaction. Write to `webhook_outbox`; a worker delivers with exponential backoff
   (1m, 5m, 30m, 2h, 12h, then dead-letter). Payloads signed HMAC-SHA256 with a per-tenant secret,
   sent as `X-ApproveX-Signature`.
6. **Maker-checker built in.** A request's creator can never approve it — including via role
   membership (skip them, require another member, or escalate). No user approves the same step twice.
7. **Fail gracefully on missing data.** Missing business field → configurable policy
   `treat_as_no_match` (default) or `reject_request`. Never a 500 for missing business fields;
   record the mismatch in `evaluationTrace`.
8. **Deterministic conflict resolution.** Multiple matches: lower integer `priority` wins → more
   conditions wins → oldest `created_at` wins. Responses always include `matchedRuleId`,
   `matchedRuleVersion`, and `evaluationTrace`.
9. **Small, tested, committed increments.** Every phase ends with passing tests and a git commit.
   The rule evaluator gets exhaustive unit tests; endpoints get integration tests; each phase gets
   at least one e2e happy path.
10. **Monolith first.** One NestJS app, modular folders (`modules/rules`, `modules/workflows`,
    ...). No microservices, Kafka, Kubernetes, or Elasticsearch in MVP.

## Tech stack (locked — do not substitute)

- Node 20+ / NestJS / TypeScript strict — modular monolith
- Prisma ORM, migrations checked into repo — PostgreSQL 16 (JSONB rule ASTs, RLS tenancy)
- Redis + BullMQ (escalation timers, webhook delivery, notifications)
- React + TypeScript + Vite; React Flow (workflow canvas); shadcn/ui + Tailwind
- Auth: email/password + JWT (access 15m / refresh 7d); Google + Microsoft OIDC in Phase 6
- OpenAPI via NestJS Swagger; Zod validation at all API boundaries (reject unknown fields)
- Docker Compose dev env; GitHub Actions CI (lint, typecheck, test, prisma migrate diff)

## Data model (Phase 1+, all tables have id uuid, tenant_id uuid, created_at, updated_at)

- `tenants` (name, slug, webhook_secret, settings jsonb), `users`, `roles`, `user_roles`,
  `permissions` + `role_permissions` (RBAC: rule:create, rule:publish, workflow:create,
  workflow:publish, request:approve, audit:view, member:manage, webhook:manage)
- `rules` (status draft|published|archived, current_version) + `rule_versions` (rule_type
  condition_tree|scoring + exactly one of condition_ast / scoring_spec jsonb (DB CHECK), priority,
  effective_from/to, published_at/by — **immutable**). See docs/ADDENDUM-PLAN.md for the addendum
  milestones (M1 operator catalog + field meta + structured trace; M2 scoring rules).
- `decision_tables` + `decision_table_versions` (columns/rows jsonb, hit policy first|all —
  compile rows to the shared condition AST)
- `workflows` + `workflow_versions` (graph jsonb; node types: approval, parallel, auto_approve,
  auto_reject, webhook_call, wait, condition_branch — **immutable**)
- `rule_workflow_bindings` (rule_version → workflow; resolves to current published workflow
  version at instantiation, then pins)
- `requests` (payload jsonb, status pending|approved|rejected|cancelled|expired,
  matched_rule_version_id, workflow_version_id pinned, idempotency_key, created_by),
  `request_steps` (node_id, assigned_role_id, due_at, escalated_to_role_id), `step_actions`,
  `delegations`
- `audit_events` (append-only, trigger blocks UPDATE/DELETE), `webhook_endpoints`,
  `webhook_outbox`, `api_keys`, `field_definitions` (per-tenant field schema registry)
- Indexes up front: (tenant_id, status) on requests; GIN on rule_versions.condition_ast;
  (tenant_id, priority) on published rule versions; (status, next_attempt_at) on webhook_outbox;
  (status, due_at) on request_steps.

## Build phases

Work strictly in order; each phase ends with tests passing, OpenAPI/README updated, and a commit.
**Ask the user before moving to the next phase.**

- [x] Phase 0 — Foundations: monorepo, compose, Prisma init, health endpoint, CI, this file
- [x] Phase 1 — Tenancy, auth (JWT), RBAC, RLS, audit_events + immutability trigger
- [x] Phase 2 — Rule engine core (evaluator in shared, exhaustive tests, dry_run only)
- [x] Phase 3 — Rule Builder UI + decision tables (+ design tokens & shared UI components first)
- [x] Phase 4 — Workflow engine + approvals (version pinning, quorum, maker-checker, execute mode)
- [x] Phase 5 — Workflow Builder UI + Inbox UI
- [x] Phase 6 — Webhooks (outbox), escalation, notifications, SSO, API keys, rate limiting
- [x] Phase 7 — Hardening, analytics, k6 load test (p95 45.8ms over 1k rules), launch prep

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
