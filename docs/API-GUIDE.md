# Integrating with ApproveX

The promise: **you do not change your application's logic — you add one HTTP call before a
business decision.** This guide is everything an integrating developer needs. Interactive
reference: `/api/docs` (Swagger) on any running instance. All endpoints live under `/api/v1`.

## 1. Get a credential

Two kinds:

- **User JWT** — `POST /auth/login` → `accessToken` (15 min) + `refreshToken` (7 days, rotated on
  every refresh). For dashboards and humans.
- **API key** — created in the dashboard (Admin → API keys) or `POST /api-keys`. Format
  `ax_<48 hex>`; shown once; scoped. **This is what your backend should use.**

```
Authorization: Bearer ax_1f4a...        # or the user JWT
```

Scopes: `evaluate` (POST /evaluate), `request:create` (POST /requests), `request:read`
(GET /requests…). Keys are rejected from every other endpoint — approving steps is human-only by
design.

## 2. Ask before you act

```bash
curl -X POST https://approvals.yourco.com/api/v1/evaluate \
  -H "Authorization: Bearer ax_..." \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: payment-8842" \
  -d '{
    "context": "PAYMENTS",
    "data": { "amount": 840000, "vendor_name": "Sharma Steel", "payment_mode": "RTGS" },
    "mode": "execute"
  }'
```

- `context` — which family of rules to consult (`PAYMENTS`, `EXPENSES`, …).
- `data` — your business payload. Dot paths work in rules (`vendor.country`, `items[0].category`).
- `mode` — `dry_run` (no side effects, full trace — use it while building) or `execute`.
- `Idempotency-Key` — same key + tenant ⇒ the original response replayed, never a duplicate
  request. **Always send one from automated systems.**

Responses you must handle:

| Outcome                         | What you see                                                                                    | What you do                                                          |
| ------------------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Auto-approved                   | `status: "approved"`, `requestId`                                                               | proceed immediately                                                  |
| Needs approval                  | `status: "pending"`, `requestId`, `pendingApprovers`                                            | park your action; wait for the webhook (or poll `GET /requests/:id`) |
| No rule matched                 | `noMatch: true`, `status: null` (policy `treat_as_no_match`) or `"rejected"` (`reject_request`) | your call — the default means "no rule cares, proceed"               |
| Rule matched, no workflow bound | `422`                                                                                           | bind a workflow to the rule (dashboard or `PUT /rules/:id/binding`)  |

Every response also carries `matchedRuleId/Name/Version`, `evaluationTrace` (per-condition
✓/✗ with actual values), and the top of the conflict-resolution ranking (`matchesConsidered`,
capped at 25; `rulesConsidered` is the full count).

`ruleType` tells you how the winning rule decided. A `condition_tree` fills
`evaluationTrace.nodes`; a `scoring` rule additionally fills `evaluationTrace.scoreBreakdown` —
every factor's value, weight, score and contribution, totalled against the threshold:

```json
{
  "ruleType": "scoring",
  "evaluationTrace": {
    "type": "scoring",
    "result": true,
    "scoreBreakdown": {
      "total": 80,
      "threshold": 60,
      "operator": ">=",
      "factors": [
        { "field": "amount", "value": 500000, "weight": 50, "score": 1, "contribution": 50 },
        {
          "field": "category",
          "value": "consulting",
          "weight": 30,
          "score": 1,
          "contribution": 30
        },
        { "field": "newVendor", "value": false, "weight": 20, "score": 0, "contribution": 0 }
      ]
    }
  }
}
```

A scoring rule is authored with `ruleType: "scoring"` and a `scoringSpec` instead of a
`conditionAst` (`POST /rules`, `PUT /rules/:id/draft`). Each factor scores one field through a
`linear`, `bands`, `map` or `boolean` function — or a `condition` function, which scores a full
condition AST and so reaches the whole operator catalog. Weights may be negative (a mitigating
factor). Missing fields score `missingScore` (default 0) and are noted in the breakdown; they
never fail the evaluation.

## 3. Hear the decision — webhooks

Register an endpoint (dashboard → Admin → Webhooks, or `POST /webhooks`). Subscribe to specific
events or leave the list empty for all of them:

`request.created` · `request.approved` · `request.rejected` · `request.cancelled` ·
`step.escalated` · `workflow.webhook_call` · `ping`

Delivery contract:

- JSON body: `{ deliveryId, attempt, event, occurredAt, data: { request: {...} } }`
- Headers: `X-ApproveX-Signature`, `X-ApproveX-Event`, `X-ApproveX-Delivery-Id`
- Retries on non-2xx / timeout: 1m, 5m, 30m, 2h, 12h → dead-letter (visible in the dashboard)
- **Answer 2xx fast** (do your work async) and **treat deliveries as at-least-once** — key your
  processing on `deliveryId` or the request id.

**Verify the signature** (per-tenant secret: dashboard → Webhooks → Reveal secret):

```ts
import { createHmac } from 'node:crypto';

function verify(secret: string, rawBody: string, header: string): boolean {
  const match = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(header);
  if (!match) return false;
  if (Math.abs(Date.now() / 1000 - Number(match[1])) > 300) return false; // replay window
  const mac = createHmac('sha256', secret).update(`${match[1]}.${rawBody}`).digest('hex');
  return mac === match[2];
}
```

Sign over the **raw** request body, before any JSON parsing. Use the "Send test" button to check
your receiver end-to-end.

## 4. Acting on requests programmatically

|                                                   |                                                                                      |
| ------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `GET /requests?status=pending&context=…`          | list (paginated)                                                                     |
| `GET /requests/:id`                               | full detail: steps, actions, timeline, pending approvers                             |
| `POST /requests`                                  | start a workflow directly, skipping rule matching (`{ workflowId, payload, title }`) |
| `POST /requests/:id/cancel`                       | requester or admin                                                                   |
| `GET /inbox`                                      | pending steps the calling **user** can act on                                        |
| `POST /steps/:id/approve` / `reject` / `delegate` | human actions (JWT only; reject requires `comment`)                                  |

Approval mechanics your integration can rely on: the requester can never approve their own
request (even via role membership or delegation); quorums are `any` / `all` / n-of-m; double
approvals return 409; everything is audited.

Workflows may contain **condition-branch nodes**: after a step resolves, the engine evaluates
each branch's condition group against the request payload and follows the first match (or the
default branch). `GET /requests/:id` shows the path taken in the timeline, so a request that
"skipped" a step usually just took another branch — check the timeline before assuming a bug.

Deleting things that workflows depend on is guarded: `DELETE /roles/:id` returns **409** while
any published workflow routes or escalates to the role (or steps are pending on it), and
`GET /roles/:id/consequences` / `GET /users/:id/consequences` tell you beforehand exactly
which workflows would be affected — use them before offboarding.

## 5. Managed lists

Tenant-scoped value lists (e.g. `high_risk_vendors`) that `IN_LIST` / `NOT_IN_LIST`
conditions reference by **name**. Edit the list and every rule referencing it picks up the
change immediately — no republish needed (the evaluation cache is invalidated on write).

|                             |                                                                                                             |
| --------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `GET /managed-lists`        | list all (id, name, values)                                                                                 |
| `POST /managed-lists`       | `{ name, values: string[] }` — duplicate name returns 409                                                   |
| `PATCH /managed-lists/:id`  | rename and/or replace `values`                                                                              |
| `DELETE /managed-lists/:id` | delete; conditions referencing a missing list **fail closed** (no match) and the trace notes `missing_list` |

Mutations require the `rule:create` permission and are audited.

## 6. Limits and errors

- **Rate limit**: 300 requests/rolling-minute per tenant (configurable) on `POST /evaluate` and
  `POST /requests`. On 429, honor `Retry-After`. `X-RateLimit-Remaining` is on every response.
- Validation is strict (Zod): unknown fields are rejected with 400 and a precise message.
- Missing _business_ fields never 500 — the condition is false and the trace says
  `missing_field`. Register field types (dashboard → Fields) to get numeric comparisons on
  string inputs.
- `401` invalid/expired credential · `403` missing permission or scope · `404` also covers
  cross-tenant ids (existence is never confirmed) · `409` conflicts (double action, duplicate
  names) · `422` semantically impossible (unbound rule, unapprovable workflow).

## 7. Sandbox-first workflow

Build rules in the dashboard → test in the **Rule Builder Test tab** (client-side, instant) →
`POST /evaluate mode=dry_run` from your staging system → flip to `execute`. The receipt-style
trace is the same at every stage because it is literally the same evaluator code.
