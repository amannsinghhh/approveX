# ApproveX — product guide

_For founders, sales, and anyone explaining ApproveX to a customer._

## The one-liner

> **Approval workflows as an API.** Your systems ask ApproveX before money moves — finance
> defines the rules without code, approvers act from a beautiful inbox, and every decision leaves
> an immutable, signed trail.

## The problem (say it in the customer's words)

Every mid-market company has approval logic. Today it lives in four bad places: hard-coded `if`
statements developers must redeploy to change, WhatsApp messages ("boss, ok to pay?"), email
chains nobody can audit, and ERP modules that need a consultant to touch. When the auditor asks
_"who approved this ₹8,40,000 payment and under what policy?"_ — nobody can answer in one click.

## Why ApproveX wins

1. **No rip-and-replace.** Camunda/Pega/ServiceNow want to _become_ your process. ApproveX is one
   HTTP call added in front of decisions your existing software already makes. Integration is an
   afternoon, not a quarter.
2. **Business owns the rules.** "Payments above ₹5,00,000 need Finance sign-off" is built in a
   visual editor or a decision-table grid — published, versioned, immutable. Changing a threshold
   is a click, not a deploy.
3. **Compliance is structural, not promised.** Maker-checker enforced at the engine level (a
   requester can physically never approve their own request), append-only audit log enforced by
   database triggers, published versions immutable, running requests pinned to the version they
   started with.
4. **Built for this market.** ₹ formatting, SLA timers with escalation, delegation for the
   week the CFO is at a wedding, and a price a mid-market Indian company will actually pay.

## The 90-second demo (this order, every time)

1. **Sign up → template.** Pick "Payment approvals" in the first-run wizard. Watch the roles,
   fields, rule, and workflow assemble themselves — each line stamped DONE. _"That was a working
   approval API. Under a minute."_
2. **The receipt.** The wizard fires a live test: ₹8,40,000 payment → ✓ amount > 5,00,000 →
   matched _Payments above 5L v1_ → workflow _Finance sign-off_. _"Every decision explains
   itself like this, forever."_
3. **The inbox.** Log in as an approver: two-pane inbox, amount in Indian grouping, SLA meter
   filling toward the deadline, J/K/A/R keyboard triage. Approve — the stamp thumps.
4. **The webhook.** Show the delivery log: signed payload, DELIVERED, attempt 1, HTTP 200.
   _"Your ERP heard about it before we switched tabs."_
5. **The audit log.** Filter to the request. Creation, approval, webhook — actor, timestamp, IP.
   _"This table physically rejects edits. Even from us."_

Close: _"You didn't see a form builder or a BPM suite. You saw your policy, enforced, explained,
and delivered back to your own software."_

## Feature inventory (complete, Phase 0–7)

**Rules engine** — visual condition builder (AND/OR/NOT, 15 operators, dot paths), decision
tables with spreadsheet grammar, per-tenant field registry with explicit typing, deterministic
conflict resolution with full ranking, effective-from/to windows, draft → publish → archive
lifecycle with immutable versions, Redis-cached evaluation (p95 < 50ms over 1,000 rules),
client-side test tab + server sandbox with receipt-style traces.

**Workflow engine** — React Flow canvas builder; approval nodes with role, any/all/n-of-m quorum,
SLA hours, escalation role, delegation toggle; parallel forks and AND-joins; condition branches;
auto-approve/reject; real webhook_call nodes; two rejection policies (kill / return to previous
step); version pinning; maker-checker preflight; graph validation with pointed errors.

**Approving** — two-pane inbox with SLA meters and keyboard triage; shared request drawer
(payload ledger, "why am I seeing this?", full timeline); requests explorer with URL-persisted
filters and deep links; ad-hoc + out-of-office delegation (both identities recorded);
comment-required rejections; cancellation.

**Integration** — `POST /evaluate` (dry_run/execute) with idempotency; direct `POST /requests`;
signed webhooks via transactional outbox with retries, dead-lettering, and a delivery log UI;
scoped API keys (plaintext shown once); per-tenant rate limiting; OpenAPI/Swagger; Google +
Microsoft SSO.

**Trust & operations** — Postgres RLS multi-tenancy (fail-closed), append-only audit log with UI,
immutability triggers, SLA escalation timers, email notifications, analytics dashboard (volume,
approval rate, time-to-decision, SLA health, webhook health), Cmd+K palette, first-run wizard
with five templates, one-VPS deploy with automatic HTTPS and nightly backups, Sentry hook.

## Objection handling

- _"We have this in our ERP."_ — Then why are approvals still happening on WhatsApp? ApproveX
  meets people where they are (inbox, email, API) and gives finance self-serve rule changes.
- _"Camunda is free."_ — Camunda is a workflow **toolkit**; you'll spend 3–6 engineer-months
  building what you just saw, then own it forever. ApproveX is a product.
- _"Is our data safe?"_ — Every table is tenant-isolated by database-level row security that
  fails closed; webhooks are HMAC-signed; the audit trail is append-only at the trigger level.
  Self-hosting on your own VPS is a first-class deployment mode.
- _"What if ApproveX is down?"_ — Your systems keep working; `/evaluate` failing is your call to
  fail open or closed per context. Idempotency keys make retries free. (SLA/uptime terms per plan.)

## Who to sell to

Mid-market Indian companies (50–2,000 employees) with real money movement and thin engineering:
manufacturing, distribution, NBFCs, D2C brands. Entry point is almost always **payments or
expenses**; land there with a template, expand to vendor onboarding, discounts, and POs — the
wizard's other four templates are the expansion map.

## What's deliberately not here (MVP honesty)

Multi-tenant membership per email, `wait` (timed) workflow nodes, auto-carry of rule→workflow
bindings across rule versions (rebind after publish), in-app members/roles management UI (API
complete, invite links work). All tracked in `CLAUDE.md` as roadmap candidates.
