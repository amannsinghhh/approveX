# ApproveX — The Complete Plain-English Guide

**Who this is for:** anyone — even if you've never written a line of code. This guide explains what
ApproveX is, how it works, how to show it to a customer, how to run it on your own laptop, and how
to put it on the internet for almost no money.

**How to read it:** the parts are in order. If you only want to *sell* it, read Parts 1–3. If you
want to *run and launch* it, read Parts 4–5. Part 6 is a one-page cheat sheet.

---

## Part 1 — What is ApproveX, in plain words?

### The problem it solves

Every company has moments where someone has to say **"yes, go ahead"** before something happens —
paying a big invoice, onboarding a new vendor, approving an expense, giving a discount.

Today, that "yes" usually happens in messy places:

- **Hard-coded in software** — a developer has to change and re-launch the app every time a rule
  changes.
- **On WhatsApp or email** — "boss, ok to pay this?" — which nobody can find later.
- **Inside a big expensive system (ERP)** that needs a consultant to touch.

Then the auditor asks: *"Who approved this ₹8,40,000 payment, and under what policy?"* — and nobody
can answer in one click.

### What ApproveX does

ApproveX is **"approvals as an API."** In plain words: your existing software quietly **asks
ApproveX first** before it does something important. ApproveX then:

1. **Checks your rules** (e.g. "payments over ₹5,00,000 need Finance to approve").
2. **Routes it to the right people** to approve or reject.
3. **Tells your software the result** (with a secure, tamper-proof message).
4. **Saves a permanent record** of exactly who approved what and when — that can never be edited or
   deleted.

The best part: **your finance/ops team sets the rules themselves with clicks — no coding, no
developer, no re-launching anything.**

### Why a company wants it (the 3-bullet version)

- **No rip-and-replace.** It's one small addition in front of decisions your software already
  makes. You keep all your existing systems.
- **Business owns the rules.** Changing "₹5 lakh" to "₹10 lakh" is a click, not a software update.
- **Compliance is built-in.** The audit trail physically cannot be faked or deleted, and nobody can
  approve their own request. Auditors love this.

### Who should buy it, and where to start

- **Best fit:** mid-sized companies (roughly 50–2,000 staff) that move real money but have a small
  tech team — manufacturing, distribution, lending (NBFCs), D2C brands.
- **Where to start:** almost always **payment approvals** or **expense approvals**. Land there,
  then expand to vendor onboarding, discounts, and purchase orders.

### Three real examples

| Situation | Without ApproveX | With ApproveX |
|---|---|---|
| A ₹8,40,000 vendor payment | Finance messages the boss on WhatsApp; no record | Software asks ApproveX → rule says "needs Finance sign-off" → approver clicks Approve → payment proceeds → permanent record saved |
| Onboarding a new vendor | Email chain, forms lost in inboxes | Request routed to the right approvers with a deadline; escalates automatically if late |
| An employee expense claim | Manager forgets, claim sits for weeks | Lands in a clean inbox with a countdown timer; approved with one keystroke |

---

## Part 2 — How it works (explained like you're 12)

### The step-by-step story

Imagine your company software is about to pay a big invoice.

1. **Your software asks first.** Before paying, it sends a quick message to ApproveX: *"I'm about
   to pay ₹8,40,000 to Acme Corp — is that OK?"*
2. **ApproveX checks the rules.** It looks at the rules your finance team set up. One rule says:
   *"payments over ₹5,00,000 need Finance approval."* This payment is bigger, so the rule matches.
3. **ApproveX asks the right people.** It creates an approval request and sends it to the Finance
   approvers. They see it in a clean inbox with the amount, the details, and a countdown timer.
4. **A person approves (or rejects).** The approver clicks **Approve**. (Rule: the person who *asked*
   can never be the one who approves — that's a built-in anti-fraud safeguard.)
5. **ApproveX tells your software the result.** It sends your software a secure "approved" message
   so the payment can go ahead.
6. **Everything is recorded forever.** Every step — the request, the approval, the notification — is
   written into a permanent logbook that **cannot be edited or deleted by anyone, including
   ApproveX itself.**

### A simple diagram for your slides

```
   Your software
        │  "Is this ₹8,40,000 payment OK?"
        ▼
   ┌─────────────┐     ┌──────────────┐     ┌───────────────┐
   │ CHECK RULES │ ──▶ │ ASK APPROVERS│ ──▶ │ TELL YOUR APP  │
   │ (which rule │     │ (inbox + SLA │     │ (secure signed │
   │  matches?)  │     │  countdown)  │     │  message)      │
   └─────────────┘     └──────────────┘     └───────────────┘
        │                    │                     │
        └────────────────────┴─────────────────────┘
                             ▼
                   ┌──────────────────────┐
                   │ PERMANENT AUDIT LOG   │
                   │ (can't be edited)     │
                   └──────────────────────┘
```

### Why it's trustworthy (one line each)

- **Records can't be faked or deleted.** The database itself blocks any attempt to change the audit
  log — even by the system's own owner.
- **No self-approval.** A person can never approve their own request, so no one can wave through
  their own payment.
- **Every company is walled off.** Each customer's data is kept separate at the database level; if
  the right "which company?" tag is missing, they see *zero* rows — never someone else's data.
- **Rules can't change under a live request.** Once a rule is published it's frozen; in-progress
  approvals keep using the exact version they started with.

### What's inside the app (the dashboard)

- **Rule Builder** — build rules with clicks ("if amount is over ₹5 lakh…").
- **Decision Table** — a spreadsheet-style way to write many rules at once.
- **Sandbox** — test a rule safely before turning it on.
- **Approval Inbox** — where approvers see and act on requests (with keyboard shortcuts).
- **Requests Explorer** — search and open any past or current request.
- **Workflow Builder** — draw the approval flow visually (who approves, in what order).
- **Analytics** — charts: how many requests, approval rate, how fast, missed deadlines.
- **First-run wizard** — a guided setup that builds a working approval flow from a template in
  under a minute.

---

## Part 3 — How to demo it in 90 seconds

Do these in order. The line to **say** is in quotes.

1. **Sign up and pick a template.** Choose *"Payment approvals"* in the setup wizard. Watch the
   rules, fields, and workflow build themselves.
   → *"That was a working approval system. Built in under a minute, no coding."*
2. **Show the live test.** The wizard fires a real test: a ₹8,40,000 payment matches the rule.
   → *"Every decision explains itself — which rule fired, and why."*
3. **Open the approval inbox.** Log in as an approver. Show the amount, the countdown timer, and
   the keyboard shortcuts.
   → *"Approvers work fast — this whole queue is keyboard-driven."*
4. **Approve one.** Click Approve. The stamp lands.
   → *"Done. The requester's software just got told, securely."*
5. **Show the secure message log.** Point at the delivery record: signed, delivered, HTTP 200.
   → *"Your other systems heard about it before we switched tabs."*
6. **Show the audit log.** Filter to this request; show the full history.
   → *"This record can never be edited — not even by us. That's what auditors want to see."*

**Closing line:** *"You didn't see a form builder or a giant system. You saw your own policy —
enforced, explained, and delivered back to your own software."*

---

## Part 4 — Run it on your own laptop

You'll use the **Terminal** app (on Mac: press ⌘+Space, type "Terminal", press Enter). You type
commands, one block at a time, and press Enter.

### What you need to install first

| Tool | Why you need it | Quick check |
|---|---|---|
| **Node.js (version 20 or newer)** | Runs the app | Type `node -v` — should show v20 or higher |
| **pnpm (version 9)** | Installs the app's pieces | Run `corepack enable pnpm`, then `pnpm -v` |
| **Docker Desktop** | The easiest way to run the database + everything | Type `docker -v` — should show a version |

> If a check fails, download the tool from its official website and install it, then try again.

### The easiest path: run everything with Docker (fewest steps)

Copy this block, paste it into Terminal, press Enter:

```bash
cd "/Users/amansingh/Desktop/rule engine"
cp .env.example .env
docker compose up
```

**What this does:** copies the default settings file, then starts *everything at once* — the
database, the background worker, the API, and the website.

**What you should see:** lots of startup text, then it settles down and keeps running (don't close
the window). The database setup runs automatically.

**Now open your web browser and go to:**

- The app: **http://localhost:5173**
- A health check (should say "ok"): **http://localhost:3000/api/v1/health**
- The API documentation: **http://localhost:3000/api/docs**

**If it didn't work:** make sure Docker Desktop is actually open and running first, then run
`docker compose up` again.

### The other path: run it natively (faster once set up)

Use this if you're doing development. Paste each block, one at a time:

```bash
cd "/Users/amansingh/Desktop/rule engine"
pnpm install
cp .env.example .env && cp .env.example apps/api/.env
```

**What this does:** installs all the app's pieces and creates two settings files (this app uses
two — one for the whole project, one just for the API; keep them identical).

Next, start the database and Redis (the simplest way is to let Docker run just those two):

```bash
docker compose up postgres redis
```

Leave that running, open a **new** Terminal tab (⌘+T), and run these:

```bash
cd "/Users/amansingh/Desktop/rule engine"
pnpm --filter @approvex/shared build
pnpm --filter @approvex/api exec prisma migrate dev
```

**What this does:** builds the shared toolkit **first** (the other parts depend on it — this order
matters), then sets up the database tables and security.

Now start the three parts, each in its own Terminal tab:

```bash
pnpm --filter @approvex/api dev            # the API (runs on port 3000)
```
```bash
pnpm --filter @approvex/worker dev         # the background worker
```
```bash
pnpm --filter @approvex/web dev --port 5199 --strictPort   # the website (port 5199)
```

**What you should see:** each one prints that it started. Then open **http://localhost:5199/signup**
in your browser and create your first account — the setup wizard takes you from zero to a working
approval flow.

> **Why port 5199 and not 5173?** It's deliberate — ports 5173/5174 are often taken by other apps,
> so 5199 avoids clashes.

### A couple of "gotchas" the project warns about

- **Always build `@approvex/shared` first** — the API, website, and worker all use it.
- **There are two `.env` settings files** on the native path (project root + `apps/api/`). Keep them
  the same.
- **Developers:** there's a rule in the code — *never* use `import type` for a class the API injects.
  It's intentional; don't "fix" it.

### Testing it works (optional)

```bash
pnpm test
```

This runs the automated checks across the whole project.

---

## Part 5 — Put it online for almost no money

The whole app is designed to fit on **one small, cheap server**. Here's the cheapest realistic way
to get it live.

### The simple steps

1. **Buy a domain and a small server.** Get a domain name (e.g. `approvals.yourcompany.com`) and a
   small VPS (a rented server) with about **2 CPUs and 4 GB memory**. Pick a Mumbai/India region
   for lower cost and faster speed for Indian users.
2. **Point your domain at the server.** In your domain settings, create an "A record" pointing your
   domain to the server's IP address. (Security certificates are set up automatically — see below.)
3. **Prepare the server.** Log into the server and run:
   ```bash
   curl -fsSL https://get.docker.com | sh
   mkdir -p /opt/approvex && cd /opt/approvex
   git clone <your-repo-url> .
   cp .env.example .env
   ```
4. **Set your secret values.** Open the `.env` file and fill in the important ones:
   ```ini
   APPROVEX_DOMAIN=approvals.yourcompany.com
   POSTGRES_PASSWORD=<a long random value>
   JWT_ACCESS_SECRET=<a long random value>
   JWT_REFRESH_SECRET=<a long random value>
   ```
   > Tip: generate a good random value with `openssl rand -hex 32`. Optional extras: `RESEND_API_KEY`
   > for emails, `SENTRY_DSN` for error alerts, Google/Microsoft login keys.
5. **Launch it.** Run:
   ```bash
   docker compose -f docker-compose.prod.yml up -d --build
   ```
   This starts everything and **sets up HTTPS (the padlock) automatically and for free.** Open
   `https://approvals.yourcompany.com`, sign up, and you're live.
6. **Lock the database password** (the default one is public), then turn on **nightly backups**:
   ```bash
   chmod +x scripts/backup.sh
   crontab -e   # add a nightly schedule line (the script explains it)
   ```
7. **To update later:** `git pull` then re-run the launch command. Updates never disturb approvals
   that are already in progress.

### What's free vs. what you pay for (cheapest stage)

| Item | Who provides it | Monthly cost |
|---|---|---|
| Small server (2–3 CPU / 4 GB) | Hetzner, DigitalOcean, Lightsail, E2E | **₹700 – ₹2,000** (the only real cost) |
| Domain name | any registrar | ~₹85 (about ₹1,000/year) |
| HTTPS security certificate | automatic (Let's Encrypt) | **FREE** |
| Email sending (up to ~3,000/mo) | Resend free tier | **FREE** |
| Error alerts | Sentry free tier | **FREE** |
| Nightly backups (on the server) | built-in script | **FREE** |
| **Total** | | **≈ ₹1,000 – ₹2,500 / month** |

### The one thing worth paying a little extra for on day one

**Off-server backups (~₹450/month)** — copies of your backups stored somewhere *other* than the
server (like cloud storage). Why: if the server itself is ever lost, your backups aren't lost with
it. It's cheap insurance; turn it on from day one.

### What makes the cost go up later (so you're not surprised)

Only **one** thing gets expensive as you grow: **the database.** The app and the background worker
stay cheap because they're simple and can be copied easily. When you get real paying customers,
your first upgrade is moving the database to a "managed" service (roughly ₹8,000–14,000/month total
at that stage). Everything else scales cheaply after that.

### Absolute-cheapest option for a quick demo

If you just want a **temporary public link** to show someone, a single tiny server (the ₹700 tier)
running the steps above is enough — a single box comfortably handles a pilot or a first design
partner. Don't buy anything bigger until real usage forces you to.

---

## Part 6 — Cheat sheet (glance at this before a customer call)

1. **What it is:** "Approvals as an API." Your software asks ApproveX before money moves; finance
   sets the rules with clicks; every decision is recorded forever.
2. **Why it wins:** no rip-and-replace, business owns the rules, and compliance (audit + no
   self-approval) is built into the database — not just promised.
3. **Who to sell to:** mid-sized Indian companies that move money with a small tech team. Start with
   **payments or expenses.**
4. **The demo:** sign up → pick a template → live test → approve from the inbox → show the signed
   message → show the un-editable audit log. 90 seconds.
5. **The cost story:** runs on one small server, ₹1,000–2,500/month to start, HTTPS/email/error
   alerts all free; only the database gets pricier as you grow.

---

### Where this came from

Everything above is drawn from your project's own documentation, so it stays true to the code:
`docs/PRODUCT.md` (the pitch), `docs/SETUP.md` (running locally), `docs/DEPLOYMENT.md` (going live +
cost breakdown), `docs/ARCHITECTURE.md` (how it works), and `README.md` (the overview). If you ever
change the app, update those files and this guide can be regenerated to match.
