# APPROVEX — SINGLE EXECUTION BRIEF
### No-login approvals (Email + WhatsApp) · Tally Connector · Core fine-tuning

> **Claude Code: read this entire file before writing any code.**
>
> This is one plan, executed in **7 checkpoints**. Complete a checkpoint, run its tests, commit, and **stop and report to me**. Do not run ahead. Do not scaffold work from later checkpoints. If a checkpoint reveals that a later one is wrong, say so instead of forcing it.
>
> Platform facts here were verified July 2026. Meta changes WhatsApp pricing quarterly; Tally changes its integration surface between releases. If reality contradicts this document, **reality wins — stop and tell me.**

---

## 0. What we're building and why

Three workstreams, deliberately interleaved so the cheap wins ship first and the risky work starts its discovery early.

| | Workstream | Why |
|---|---|---|
| **A** | **Email + WhatsApp approvals (no login)** | A 55-year-old CFO will not log into a web app. He will click a button in an email or reply on WhatsApp. Approval latency is dominated by "the approver hasn't opened the app yet." |
| **B** | **Tally connector** | Our target customer runs Tally, not SAP. This turns integration from "lend us an engineer for two weeks" into "install this, done." |
| **C** | **Fine-tuning** | Small fixes to the existing engine, workflow, UI, and ops that each kill a support ticket or win a demo. |

---

## 1. Non-negotiable principles (these override everything below)

1. **A `GET` request never mutates state.** Non-negotiable, and §2 explains why it would otherwise destroy us.
2. **The Bridge never destroys accounting data.** Alter and cancel only — never delete, never overwrite. If the Bridge is ever unsure, it **stops and flags**. "Did something clever" is an unacceptable failure mode when touching a company's books. "Stopped and asked" is fine.
3. **Idempotency everywhere.** Office internet drops mid-sync. Assume it. Every submission carries a stable key derived from the source object.
4. **Money is integers in minor units.** If `amount` is a float anywhere, fix it in Checkpoint 6. A `0.1 + 0.2` bug in a finance product destroys trust permanently.
5. **Every state change lands in the immutable audit log**, with the **channel** recorded (`web` | `email` | `whatsapp` | `api` | `tally`).
6. **Tests alongside features, not after.** Every checkpoint ends with green tests and a commit.

---

# CHECKPOINT 1 — Signed approval tokens (the security foundation)

**Everything in Workstream A rests on this. Get it exactly right.**

### The bug we are preventing

Corporate email gateways (Outlook Safe Links, Proofpoint, Mimecast) **prefetch every URL in an inbound email** to scan for malware. If an approval link is a `GET` that performs the approval, **the scanner approves the request before the human ever sees the email.** Every request silently auto-approves, and the audit log records that a human did it. This has happened to real products. It would end ours.

> **The test to hold in your head:** *"If a robot fetches every URL in this email, what happens?"*
> **Correct answer: "A page renders. Nothing changes."**

### Schema

```
approval_tokens
  id, tenant_id, step_id, user_id
  token_hash        sha256, UNIQUE, INDEXED   -- never store the raw token
  allowed_actions   text[]  ['approve','reject']
  channel           'email' | 'whatsapp'
  expires_at        timestamptz
  consumed_at       timestamptz NULL
  consumed_ip, consumed_user_agent
  created_at
```

Add to `step_actions`: `channel` column. It flows into the audit log and the compliance export.

### Rules

- Token is bound to `(step_id, user_id, allowed_actions)`. It can do exactly one thing, for one person, on one step.
- Expiry = the step's SLA, or 7 days, whichever is **sooner**.
- **Single use.** Consumed atomically (`UPDATE ... WHERE consumed_at IS NULL RETURNING *`) — a race must not double-approve.
- Store `sha256(token)` only. Treat the raw token exactly like a password.
- Rate-limit attempts per IP and per token. Log every failed / expired / reused token as a security event.

### Tenant policy: the no-login value ceiling

A forwarded email is a **bearer credential** — whoever holds it can act as the recipient. Mitigate:

- Tenant setting `no_login_approval_max_amount`, **default ₹5,00,000**.
- Above it, the landing page refuses and offers a login link that deep-links back to the request.
- Settings UI shows it as a policy with a plain-English consequence line: *"Requests above this amount will require a full login to approve, even from an email link."*

### Tests (all must pass before moving on)

- [ ] A `GET` to the landing URL changes **nothing** in the database. (Simulate the scanner: fetch every URL in the email body, assert zero state change.)
- [ ] Token reuse → friendly "already approved by you at 09:31" page, not a 500.
- [ ] Two concurrent `POST`s with the same token → exactly one action recorded.
- [ ] Expired token → clear message + login link.
- [ ] Token for an already-decided step → "Already handled by Priya. No action needed."
- [ ] Request over the ceiling → refuses, offers login.
- [ ] Raw token never appears in the DB, the logs, or any error message.

**Commit. Stop. Report.**

---

# CHECKPOINT 2 — Email approvals

### Flow

```
Step assigned
  → email with request summary + [Review & Approve] button
  → GET /a/{token}   → renders a page. Mutates nothing.
  → human clicks Approve
  → POST /a/{token}/approve   → token consumed, step decided
  → confirmation page + the stamp animation
```

### The landing page

A **real page**, mobile-first (most people open this on a phone). Shows:

- Amount, vendor, and the full payload as a key/value ledger
- The **"why you're seeing this"** line: *"Matched rule Payments above ₹5,00,000 (v3) → workflow Manager → Finance Head → CFO. Step 2 of 3."*
- Who has already approved, and who comes next
- The SLA countdown
- Actions: **Approve** · **Reject** · **Open in ApproveX**

**Reject always requires a reason** — so reject is never one-click; it lands on the page and asks.

### Emails

Add the Approve button to every step-assignment notification. Keep the existing per-user notification preferences — if a user has muted assignment emails, they stay muted.

### Tests

- [ ] Full E2E: assign step → email sent → GET renders → POST approves → webhook fires → audit shows `channel: email`.
- [ ] Cancelled / expired request → page explains, doesn't error.
- [ ] Over-ceiling request → login required.

**Commit. Stop. Report.**

> **Then: ship it and leave it live for two weeks before touching WhatsApp.** Email is 80% of this feature's value at 10% of its cost. WhatsApp is a channel swap on top of a proven token model — not a parallel build.

---

# CHECKPOINT 3 — Start the Tally spike (do this NOW, in parallel)

**This is the only work in the whole plan with real unknown-unknowns. Start discovering them while there's still time to change the plan.**

**I (Aman) must do step 1 — buy and install a TallyPrime licence.** You cannot build this from documentation; the XML API's real behaviour differs from every guide, including this one.

Then, against a **backed-up test company**, spike and report back:

1. **Export payment vouchers.** Tally listens on port 9000 as an HTTP server taking XML. The envelope shape is `ENVELOPE > HEADER (VERSION, TALLYREQUEST=EXPORT, TYPE=COLLECTION, ID) + BODY > DESC > STATICVARIABLES (SVCURRENTCOMPANY, SVFROMDATE, SVTODATE) + TDL` defining a voucher collection filtered by voucher type. **Confirm the real tag names against the live install and correct this document.**
2. **Confirm `ALTERID` works as an incremental cursor.** It should increment on every voucher change — that's our "what's new since I last looked."
3. **Alter a voucher's type, and cancel a voucher, via XML import.** Confirm we can do this *without corrupting the books.* Back up first.
4. **Confirm the concurrency limit** — Tally processes one XML request at a time.

**Deliverable: a working REPL script + a corrected version of §B below.** No production code yet.

**Report findings before Checkpoint 5.**

---

# CHECKPOINT 4 — WhatsApp approvals

*(Only after email has been live and stable for two weeks.)*

### Verified platform facts (July 2026)

- Per-message pricing since 1 July 2025. Each delivered template message is billed by **category** and recipient country.
- **India: utility ≈ ₹0.115/msg. Marketing ≈ ₹0.86/msg.** An approval notification is **unambiguously utility**. Misclassifying utility as marketing is the single most expensive mistake Indian businesses make on this platform — same message, 7.5× the price. **Submit the template as Utility and never let the category drift.**
- Every template needs Meta pre-approval (usually hours).
- Setup: business verification (GST cert / incorporation docs), plus a dedicated number not active on consumer WhatsApp or the Business App.
- 18% GST on top; BSPs mark up 10–30%.

### ⚠️ The deadline that shapes our cost model

Utility templates inside the 24-hour customer service window are free **only through 30 September 2026.** From 1 October, Meta charges for them, and bills free-form replies too.

**So: assume every message is billed.** The math still works —

> 500 approvals/month × 2 approvers ≈ 1,000 utility messages ≈ **₹150–200/month all-in.**
> Against a ₹25,000/month subscription that is a rounding error.
> **Absorb it into the plan price.** Do not build metering. Do not pass it through. Do not let it become a pricing conversation.

### Design: URL button, NOT quick-reply buttons

| Option | Verdict |
|---|---|
| Quick-reply buttons (approve inside the chat) | Slicker, but: fixed button labels, inbound message routing, session windows, tap→step mapping. Many more ways to fail. |
| **URL button → the landing page from Checkpoint 2** ✅ | **One code path, one security model, one thing to test.** Already built. |

**Take the URL button.** Revisit quick-reply only once the channel has earned it.

### Template (submit as **Utility**)

```
🔔 Approval needed — {{1}}

Amount:    {{2}}
Vendor:    {{3}}
Raised by: {{4}}
Due:       {{5}}

[ Review & Approve ]   ← URL button → approvals.yourco.com/a/{{token}}
```

### Opt-in (required by Meta *and* the DPDP Act)

- **Settings → My profile → WhatsApp approvals**: enter number → OTP → verify. Store `phone_verified_at`.
- Explicit, timestamped consent checkbox with plain wording.
- One-click opt-out in every message footer and in the profile.
- **Never send to an unverified number. Ever.**

### Implementation

- Build a `NotificationChannel` interface (`email`, `whatsapp`, later `slack`). The WhatsApp sender is one implementation — swapping BSPs later must be a one-file change.
- **Start with a BSP** (AiSensy / Interakt / Gupshup / WATI). Template rejections and quality-rating throttles are an annoying way to learn. Move to Meta Cloud API direct in ~6 months if volume justifies it.
- Log every send/delivery/read to a `whatsapp_deliveries` table, surfaced in admin like the webhook delivery log.

**Commit. Stop. Report.**

---

# CHECKPOINT 5 — Tally Bridge

*(Corrected by whatever Checkpoint 3 actually found.)*

### The constraint that dictates the architecture

Port 9000 **must never be exposed to the internet** — Tally has no meaningful auth. Tally sits on a Windows box on the office LAN. And **the machine gets shut down at 6pm.**

**Therefore we ship a local agent. There is no cloud-only version of this.** Accept it — it's a moat. It's exactly the unglamorous work a Western competitor will never do.

```
┌── Customer's office LAN ─────────┐        ┌── Our cloud ──┐
│                                  │        │               │
│  TallyPrime ◄─XML/9000─► Bridge  │──HTTPS─►  ApproveX API │
│  (Windows)              (tray)   │◄─poll──│               │
└──────────────────────────────────┘        └───────────────┘
```

**Outbound HTTPS on 443 only. No inbound firewall rules, no VPN, no port forwarding, no IT ticket.** That sentence is the entire sales pitch — put it verbatim in the docs.

### How a voucher "waits" (Tally has no pending state)

**v1: two voucher types. No TDL.** The customer creates a `Payment (Pending Approval)` voucher type in Tally (five minutes of clicking). The Bridge watches it and converts it to a normal `Payment` on approval.

Nothing compiled, nothing deployed into their Tally, nothing to break on the next Tally release. (TDL custom fields are cleaner and show status inside Tally — that's **v2**, and we charge for it.)

### The Bridge

A single **signed Windows binary** (Go, or Node via `pkg`), installing as a Windows Service with a tray icon. Setup asks for exactly two things: **an ApproveX pairing code**, and **the Tally port**.

**Four loops:**

1. **Discover** — which company is loaded, which voucher types exist. If `Payment (Pending Approval)` is missing, fail with *"Create a voucher type named 'Payment (Pending Approval)' in Tally, then click Retry"* — **not a stack trace.**
2. **Poll** (30s) — export vouchers of the pending type where `ALTERID > cursor`. Persist the cursor in local SQLite; survive restarts.
3. **Submit** — `POST /evaluate`, `context: "TALLY_PAYMENT"`, `externalRef: <voucher GUID>`, **`Idempotency-Key: <voucher GUID>`**. That key is what makes this safe when the office internet drops mid-sync — which it will.
4. **Apply decisions** — long-poll ApproveX:
   - **Approved** → XML import, `Action="Alter"`, change voucher type to `Payment`, stamp narration with approver + timestamp so the record also lives inside Tally.
   - **Rejected** → `Action="Cancel"`, rejection reason into the narration.

**Non-negotiable Bridge behaviours:**

- **One serialized request queue to Tally.** It handles one XML request at a time. Concurrency corrupts.
- **Local SQLite queue survives everything** — internet down 6 hours, Tally shut overnight, machine rebooted. **Never lose a voucher. Never double-submit one.**
- **Alter and cancel only. Never delete or overwrite.** Unsure → stop and flag.
- **Plain-English status window:** `Connected to Tally ✓ · Company: Acme Pvt Ltd · 3 pending · Last sync 12s ago`. The accountant must see it's alive without phoning us.
- **Auto-update**, signed binaries. **One-click log export** from the tray icon.

### Failure cases (each is a test)

- [ ] Tally closed (evening) → queue, retry, no data loss, status shows "Tally offline"
- [ ] Internet down 6 hours → queue, retry, no duplicates on recovery
- [ ] Machine rebooted mid-sync → resume from cursor, no double-submit
- [ ] A human edits a pending voucher while it's awaiting approval → detect via `ALTERID`, flag it, **do not silently approve the changed version**
- [ ] Tally mid-rewrite (Ctrl+Alt+R) → Bridge backs off cleanly
- [ ] Multi-company Tally → each company maps to its own ApproveX entity

### Tell customers up front (put this in the onboarding doc)

- **Tally shuts at 6pm.** Approvals still work — they live in ApproveX. The *write-back* happens when the machine comes back. Customers wanting 24×7 sync need Tally on a cloud VPS. That's an upsell conversation, not a bug.
- **Multi-company is the norm**, and we support it.
- **We don't touch ODBC** — deprecated from TallyPrime 4.0, and read-only anyway.

**Commit. Stop. Report.**

---

# CHECKPOINT 6 — Fine-tuning

Small, cheap, each one kills a support ticket or wins a demo. Do them all.

### Engine
- **Warm the Redis rule-set cache on publish**, not lazily on first evaluate — the first request after a policy change shouldn't be the slow one.
- **`ALREADY_DECIDED` as a first-class response**, not a cryptic 409. Concurrent approvals are normal, not an error.
- **Return the evaluation trace on every response**, not just dry runs. It's already computed. A developer debugging at 11pm will thank us; it costs nothing.
- **Timezone correctness pass.** Business-hours and day-of-week rules evaluate in the *tenant's* timezone. Write a test that runs at 23:45 IST and asserts the correct day.
- **Money as integers in minor units, everywhere.** Audit every currency path. This is the highest-priority item in this checkpoint.

### Workflow
- **"Role has zero members" becomes a publish-time BLOCKER**, not a warning. A workflow routing to an empty role is a request that will strand.
- **Auto-nudge at 75% of SLA.** Most escalations are avoidable, and every one avoided is a manager who didn't get annoyed by us.
- **Escalation loop protection** — if the escalation target is also empty, route to a tenant-level `Fallback approver` and alert an admin. Never escalate into a void.

### UI
- **Optimistic approve** — the stamp lands instantly, reconciles after.
- **Preserve list position after acting** — approving from the inbox should advance to the *next* item, not bounce to the top. Biggest ergonomics win for someone clearing 40 items.
- **5-second undo window** before commit + webhooks fire. Removes misclick fear, which is what makes people slow in a UI we want them fast in.
- **The empty inbox is a reward:** `ALL CLEAR` stamp + *"You cleared 23 requests this week, averaging 4 minutes each."*

### Ops
- **Webhook dead-letter alerts** → email the tenant admin. Today it fails silently and they learn about it a week later from their finance team.
- **Tenant Health score** on Settings: rules without a fallback, roles with no members, workflows never triggered, webhooks failing, approvers inactive 30+ days. Five queries. Makes the product feel like it's looking after them.

**Commit. Stop. Report.**

---

# CHECKPOINT 7 — Pilot

- **Email/WhatsApp:** enable for one friendly customer. Watch the audit log for `channel` distribution. If nobody uses the email button, the button is in the wrong place.
- **Tally:** pilot with **one** customer, on a **backed-up test company**, for **two weeks** before it touches a live ledger.

> **The caution I want you to hold onto:** don't sell the Tally connector until it has survived that pilot. A connector that corrupts an accountant's books doesn't lose one customer — in the Indian mid-market, where CA firms and finance heads all talk to each other, it ends the product.
>
> **Move fast on email. Move carefully on Tally.**

---

# Timeline

| Week | Work |
|---|---|
| 1 | CP1 tokens · **CP3 Tally spike starts in parallel** |
| 2 | CP2 email approvals → **ship** |
| 2–3 | CP6 fine-tuning (small, runs alongside) |
| 3–4 | CP4 WhatsApp (after email has proven itself) |
| 4–8 | CP5 Tally Bridge |
| 9–10 | CP7 pilots |

---

## Start here

**Checkpoint 1 only.** Build the token service and the security tests. Do not write the landing page, do not touch email, do not think about Tally.

When CP1's tests are green: commit, and report back to me.