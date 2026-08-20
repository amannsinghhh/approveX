# Production deployment

One VPS (2 vCPU / 4GB is plenty to start), Docker Compose, Caddy for automatic HTTPS. Total cost
to start: a domain plus a ~₹1,000/month server — see [What it costs to run](#what-it-costs-to-run)
for the full breakdown at each stage of growth.

## 1. Point DNS

Create an A record: `approvals.yourcompany.com → <server IP>`. Caddy provisions the TLS
certificate automatically on first request.

## 2. Prepare the server

```bash
# as root on a fresh Ubuntu LTS box
curl -fsSL https://get.docker.com | sh
mkdir -p /opt/approvex && cd /opt/approvex
git clone <your-repo-url> .
cp .env.example .env
```

Edit `.env` — the production-critical values:

```ini
APPROVEX_DOMAIN=approvals.yourcompany.com
POSTGRES_PASSWORD=<long random>            # owner role password
JWT_ACCESS_SECRET=<long random>
JWT_REFRESH_SECRET=<long random>
# optional but recommended:
SENTRY_DSN=...                             # error monitoring
RESEND_API_KEY=... MAIL_FROM="ApproveX <approvals@yourcompany.com>"   # email notifications
OIDC_GOOGLE_CLIENT_ID=... OIDC_GOOGLE_CLIENT_SECRET=...              # SSO buttons appear automatically
```

> `openssl rand -hex 32` generates good secrets. For Google SSO register the redirect URI
> `https://approvals.yourcompany.com/api/v1/auth/oidc/google/callback` (Microsoft: same with
> `microsoft`).

## 3. Launch

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

What comes up: Postgres (volume-backed), Redis, the API (runs `prisma migrate deploy` first),
the worker, a one-shot job that copies the built dashboard into Caddy's web root, and Caddy on
80/443. Open `https://approvals.yourcompany.com`, sign up, and the first-run wizard takes it from
there.

**Harden the app DB role** (the dev default password is public):

```bash
docker compose -f docker-compose.prod.yml exec postgres \
  psql -U approvex -d approvex -c "ALTER ROLE approvex_app PASSWORD '<strong password>'"
# then set APP_DB_PASSWORD=<same> in .env and: docker compose -f docker-compose.prod.yml up -d api
```

## 4. Backups

```bash
chmod +x scripts/backup.sh
crontab -e     # add:
# 15 2 * * * cd /opt/approvex && ./scripts/backup.sh >> /var/log/approvex-backup.log 2>&1
```

Nightly `pg_dump` (custom format, gzipped) into `/var/backups/approvex`, newest 14 kept. The
restore command is documented at the bottom of the script. Test a restore once before you need it.

## 5. Upgrades

```bash
cd /opt/approvex && git pull
docker compose -f docker-compose.prod.yml up -d --build
```

Migrations are forward-only and run automatically before the API starts. Published rule/workflow
versions are immutable and running requests are pinned, so an upgrade never changes in-flight
approvals.

## 6. Operations cheat-sheet

| Question                      | Command / place                                                                        |
| ----------------------------- | -------------------------------------------------------------------------------------- |
| Is everything up?             | `docker compose -f docker-compose.prod.yml ps` · `curl https://<domain>/api/v1/health` |
| Why did a webhook not arrive? | Dashboard → Admin → Webhooks → Deliveries (attempts, last code, next retry)            |
| API errors?                   | `docker compose ... logs -f api` — plus Sentry if configured                           |
| Worker heartbeat?             | `docker compose ... logs -f worker` (`started (bullmq)` + per-tick stats)              |
| Rate limit tuning             | `RATE_LIMIT_RPM` in `.env` (default 300/min per tenant)                                |
| Who did what?                 | Dashboard → Audit log (append-only, trigger-enforced)                                  |

## What it costs to run

ApproveX is deliberately cheap to operate — the whole stack fits on one small box because the
heavy lifting (rule evaluation) is in-process and Redis-cached, not a fleet of services. Below are
2026 street prices; pick a **Mumbai / ap-south region** for both cost and latency to Indian users.
Prices are indicative and converted at ~₹86/USD; check current rates.

### Stage 1 — Single VPS (everything on one box) · **~₹1,000–2,500 / month**

Everything in `docker-compose.prod.yml` (API, worker, Postgres, Redis, Caddy) on one server. This
comfortably serves a handful of tenants and thousands of evaluations/day — it is what the load
test ran on (p95 45.8ms).

| Item                 | Provider examples                         | Monthly           |
| -------------------- | ----------------------------------------- | ----------------- |
| VPS 2–3 vCPU / 4GB   | Hetzner CPX21, DO Droplet, E2E, Lightsail | ₹700 – ₹2,000     |
| Domain (.com / .in)  | amortised from ~₹1,000/yr                 | ~₹85              |
| TLS certificate      | Caddy → Let's Encrypt                     | **₹0**            |
| Email (up to ~3k/mo) | Resend free tier                          | **₹0**            |
| Error monitoring     | Sentry free tier (5k events)              | **₹0**            |
| Backups (local disk) | `scripts/backup.sh`, 14-day rotation      | **₹0**            |
| **Total**            |                                           | **~₹1,000–2,500** |

> Add ~₹450/mo for off-box backups (Cloudflare R2 / S3 / DO Spaces) — strongly recommended so a
> lost server isn't a lost business. It's the one upgrade worth making on day one.

### Stage 2 — Managed data (first paying customers) · **~₹8,000–14,000 / month**

Move Postgres and Redis off the app box so the database has its own backups, failover, and
point-in-time restore. The app VPS stays small; data gets the durability customers will ask about
in security review.

| Item                      | Provider examples                      | Monthly            |
| ------------------------- | -------------------------------------- | ------------------ |
| App VPS 2 vCPU / 4GB      | (as above)                             | ₹700 – ₹2,000      |
| Managed Postgres 16 (HA)  | DO Managed DB, Neon, RDS, Supabase Pro | ₹2,000 – ₹6,000    |
| Managed Redis             | DO, Upstash, Redis Cloud               | ₹850 – ₹1,700      |
| Email 50k/mo              | Resend paid                            | ~₹1,700            |
| Error + uptime monitoring | Sentry Team + a pinger (Betterstack)   | ~₹2,600            |
| Off-site backups          | R2 / S3 / Spaces                       | ~₹450              |
| **Total**                 |                                        | **~₹8,000–14,000** |

To point the app at managed data, set `DATABASE_URL` / `APP_DATABASE_URL` / `REDIS_URL` in `.env`
and drop the `postgres` and `redis` services from the prod compose file — nothing in the app code
changes.

### Stage 3 — Scale-out (many tenants, HA) · **~₹30,000+ / month**

Two+ app replicas behind Caddy (or a load balancer), the worker scaled horizontally (safe as-is —
all claiming is `FOR UPDATE SKIP LOCKED`), a larger managed Postgres with read replica, and
managed Redis with failover. Cost grows with Postgres size first; the app and worker tiers stay
cheap because they're stateless. Budget monitoring/observability (Sentry, log retention, uptime)
as a fixed ~₹3,000–5,000 line at every stage above.

### Rules of thumb

- **The database is the only thing that gets expensive.** API and worker are stateless and small
  — scale them last and cheaply. Move Postgres to managed **first**.
- **Per-tenant marginal cost is near zero** until you're pushing serious evaluation volume —
  rules live in JSONB and evaluate in-process; there's no per-tenant infrastructure.
- A single Stage 1 box can host a pilot or a design-partner customer indefinitely. Don't
  over-provision before you have the load to justify it.

## Scaling notes (when you outgrow one box)

- The API is stateless — run more replicas behind Caddy (`reverse_proxy api:3000 api2:3000`).
- The worker is safe to scale horizontally as-is: all claiming is `FOR UPDATE SKIP LOCKED`.
- Postgres is the real ceiling; move it to managed Postgres first, everything else last.
