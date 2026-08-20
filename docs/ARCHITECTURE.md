# How ApproveX works

ApproveX is a multi-tenant approval engine behind one HTTP call. Your application asks
**"may I do this?"** before acting; ApproveX matches a rule, runs the approval workflow, and tells
your application the outcome — synchronously when it can auto-decide, via signed webhook when
humans are involved.

```
your app ──POST /evaluate──▶ rule engine ──▶ workflow engine ──▶ approvers (inbox / API)
   ▲                                                                    │
   └───────────────── signed webhook (request.approved / rejected) ◀────┘
                              every step → immutable audit log
```

## The pieces

pnpm monorepo, four packages:

| Package           | What it is                                                                                                                              |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api`        | NestJS modular monolith — every endpoint, both engines, all guards                                                                      |
| `apps/worker`     | Background jobs — webhook delivery, SLA escalation timers, email notifications                                                          |
| `apps/web`        | React + Vite dashboard — the "ledger + stamp" UI                                                                                        |
| `packages/shared` | Pure logic used by API, worker, **and** browser: the rule evaluator, decision-table compiler, workflow graph validator, webhook signing |

Postgres 16 is the source of truth. Redis serves three jobs: rule-set cache, rate-limit windows,
BullMQ scheduling. Redis dying degrades performance, never correctness — every consumer falls back
to the database.

## The request lifecycle, end to end

1. **`POST /evaluate`** arrives with `{ context, data, mode }` and optionally an
   `Idempotency-Key`. Auth is a user JWT or an `ax_…` API key (scope-checked).
2. **Rule matching.** The published rules of that context (Redis-cached, 1h TTL, invalidated on
   publish) are each evaluated against the payload by the shared evaluator. Conflict resolution is
   deterministic: lowest integer `priority` wins → more conditions wins → oldest rule wins. The
   response always names the matched rule + version and carries a full per-condition trace for the
   winner (`matchesConsidered` shows the top of the ranking; ranking of large sets uses a
   trace-free fast path and re-traces only the winner).
3. **Workflow instantiation** (mode `execute`). The matched rule version's binding resolves to the
   current published workflow version, and the request **pins** that version forever — publishing
   a new version never touches running requests. Maker-checker preflight runs first: a node whose
   only eligible approver would be the requester is rejected with a 422 _before any row exists_
   (or silently escalated when the node has an escalation role).
4. **Graph execution.** Node types: `start`, `approval`, `parallel`, `condition_branch`,
   `auto_approve`, `auto_reject`, `webhook_call`, `wait`. Multiple outgoing edges fork; a node
   with multiple incoming edges is an AND-join (waits for all); `condition_branch` picks the first
   matching conditional edge, else the default. Engine bookkeeping (`{completed[], delivered[]}`)
   lives on `requests.engine_state`.
5. **Approvals.** Eligibility = active role members, minus the requester (always), plus ad-hoc
   step delegates and out-of-office delegates (both identities are recorded). Quorums: `any`,
   `all`, or `{ n }` clamped to the eligible count. Every transition runs in one transaction with
   row locks (request first, then step) — two people approving the same step at the same instant
   resolve to exactly one decider and one 409.
6. **Decision.** Terminal states write the audit event **and the webhook outbox rows in the same
   transaction** — an outcome and its notification cannot disagree. Rejections follow the
   workflow's policy: kill the request, or rewind to the previous step.
7. **Delivery.** The worker claims due outbox rows (`FOR UPDATE SKIP LOCKED` + a 5-minute crash
   lease), signs the payload HMAC-SHA256 with the tenant secret, POSTs with a 10s timeout, and
   retries on 1m/5m/30m/2h/12h before dead-lettering. The dashboard shows the delivery log.

## Tenancy: two connections, RLS always on

Every domain table carries `tenant_id`, and Postgres Row-Level Security enforces isolation _in
addition to_ application scoping:

- `DATABASE_URL` — the **owner** role. Migrations, auth bootstrap (login happens before a tenant
  context exists), audit writes, and the worker's cross-tenant scans.
- `APP_DATABASE_URL` — the **`approvex_app`** role, which does not own the tables, so RLS always
  applies. All tenant-scoped queries run here through
  `TenantPrismaService.forTenant(tenantId)` / `transactionForTenant(...)`, which set
  `app.tenant_id` on the transaction. No tenant context ⇒ policies compare against NULL ⇒ **zero
  rows**. A forgotten filter fails closed instead of leaking.
- Cross-tenant lookups by UUID return **404**, never 403 — existence is not confirmed.

## Immutability and audit

- Published rule / decision-table / workflow versions are immutable — a database trigger rejects
  UPDATE and DELETE even for the table owner. Edits create the next draft version.
- `audit_events` is append-only, enforced by another trigger. Every state change lands there: a
  global interceptor logs every mutating endpoint, and the engines write richer domain events
  (`request.approved`, `step.escalated`, `webhook.dead_lettered`, …) themselves.

## The rule evaluator (packages/shared)

A pure function over a JSON condition AST: `AND`/`OR`/`NOT` (max depth 10, 200 nodes) over 15
comparison operators including `IN`, `BETWEEN`, `CONTAINS`, and `MATCHES_REGEX`. Semantics chosen
for auditability:

- Missing field ⇒ condition false + `missing_field` trace note. Never a 500.
- No silent coercion: the per-tenant field registry declares types; `"500000" > 500000` is only
  true for a registered `number` field. Mismatches are false (even for `!=`) + `type_mismatch`.
- Traced evaluation never short-circuits, so the receipt shows the whole green/red tree. (A
  `collectTrace:false` fast path may short-circuit — verdicts are identical, evaluation is pure.)
- `MATCHES_REGEX` is ReDoS-screened at authoring _and_ eval time, plus a hard timeout on a
  persistent worker thread (V8 regexes ignore vm timeouts; `Atomics.wait` does not).

Decision tables compile to this same AST (`*`, `> 500000`, `50000..500000`, `a, b` cell grammar),
so the grid and the builder share one execution engine — and the browser runs the _same compiled
code_ for the Rule Builder's Test tab and the sandbox.

## Idempotency, exactly

`POST /evaluate` and `POST /requests` accept `Idempotency-Key`. The original response is
snapshotted on the request row and replayed verbatim for the same tenant + key; a concurrent
duplicate loses the unique-constraint race, fetches the snapshot, and replays it. Your ERP can
retry forever without double-creating approvals.

## Background jobs (apps/worker)

Three BullMQ repeatable jobs (plain timers if Redis is down at boot):

| Job                  | Every | What it does                                                                                                     |
| -------------------- | ----- | ---------------------------------------------------------------------------------------------------------------- |
| `deliver-webhooks`   | 10s   | Claim + sign + POST due outbox rows; schedule retries; dead-letter                                               |
| `escalate-steps`     | 30s   | Overdue pending steps: reassign to the escalation role (audit + webhook + re-notify) or flag `step.sla_breached` |
| `send-notifications` | 20s   | Email approvers on step activation/escalation; email requesters on decisions (Resend, or log-only)               |

All claims are row-level (`SKIP LOCKED` / claim-stamp columns), so any number of workers can run
concurrently and each row is handled once. No HTTP call ever runs inside a database transaction.

## Performance

Phase 7 k6 verification: 1,000 published rules in one context, 20 VUs for 30s against
`POST /evaluate` — **p95 45.8ms** (avg 36.9ms, ~540 req/s, 0 errors) on a dev laptop. The two
hardening changes that got it there: `matchesConsidered` capped at 25 entries (uncapped it was
~145KB per response), and trace-free ranking with winner-only re-trace.
