import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  FileSpreadsheet,
  GitBranch,
  Lock,
  ScrollText,
  ShieldCheck,
  Table2,
  Users,
  Webhook,
  Zap,
} from 'lucide-react';
import { Wordmark } from '../components/AppShell';
import { StampChip } from '../components/StampChip';
import { useCountUp } from '../lib/motion';

/* ─── Sticky top navigation ──────────────────────────────────────────────── */
function TopNav(): React.JSX.Element {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = (): void => setScrolled(window.scrollY > 8);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header
      className={
        'fixed inset-x-0 top-0 z-50 transition-all duration-200 ' +
        (scrolled
          ? 'border-b border-rule bg-surface/80 backdrop-blur-md elev-sm'
          : 'border-b border-transparent')
      }
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <Wordmark />
        <nav className="hidden items-center gap-7 text-base text-ink-soft md:flex">
          <a href="#how" className="transition-colors hover:text-ink">
            How it works
          </a>
          <a href="#features" className="transition-colors hover:text-ink">
            Features
          </a>
          <a href="#developers" className="transition-colors hover:text-ink">
            Developers
          </a>
          <a href="#trust" className="transition-colors hover:text-ink">
            Trust
          </a>
        </nav>
        <div className="flex items-center gap-2">
          <Link
            to="/login"
            className="press inline-flex h-9 items-center rounded-[6px] px-3 text-base font-medium text-ink transition-colors hover:text-brand"
          >
            Log in
          </Link>
          <Link
            to="/signup"
            className="btn-grad press inline-flex h-9 items-center gap-1.5 rounded-[6px] px-4 text-base font-medium text-white"
          >
            Get started <ArrowRight size={15} />
          </Link>
        </div>
      </div>
    </header>
  );
}

/* ─── Hero ───────────────────────────────────────────────────────────────── */
function Hero(): React.JSX.Element {
  return (
    <section className="relative overflow-hidden px-6 pb-20 pt-36">
      {/* aurora backdrop */}
      <div
        className="aurora h-80 w-80"
        style={{ top: '-4rem', left: '8%', background: 'var(--brand)' }}
      />
      <div
        className="aurora h-96 w-96"
        style={{ top: '2rem', right: '-4rem', background: 'var(--brand-2)', animationDelay: '4s' }}
      />
      <div
        className="aurora h-64 w-64"
        style={{
          top: '18rem',
          left: '38%',
          background: 'var(--stamp-approve)',
          opacity: 0.28,
          animationDelay: '7s',
        }}
      />

      <div className="relative z-10 mx-auto grid max-w-6xl items-center gap-12 lg:grid-cols-[1.05fr_1fr]">
        {/* copy */}
        <div>
          <span className="inline-flex items-center gap-2 rounded-full border border-rule bg-surface/70 px-3 py-1 font-mono text-xs text-ink-soft backdrop-blur">
            <span className="h-1.5 w-1.5 rounded-full bg-approve" /> Approval infrastructure, as an
            API
          </span>
          <h1 className="mt-5 text-[40px] font-bold leading-[1.08] tracking-tight text-ink sm:text-[52px]">
            Business rules and approvals, <span className="text-grad">enforced</span> and{' '}
            <span className="text-grad">explained.</span>
          </h1>
          <p className="mt-5 max-w-xl text-md leading-relaxed text-ink-soft">
            You don&apos;t need to change your existing application. Just call our API before you
            take a business decision. Finance and ops define the rules and approval flows — no code
            — and every outcome leaves an immutable, signed trail.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link
              to="/signup"
              className="btn-grad press inline-flex h-11 items-center gap-2 rounded-[8px] px-6 text-md font-medium text-white"
            >
              Start free <ArrowRight size={17} />
            </Link>
            <a
              href="#how"
              className="press inline-flex h-11 items-center gap-2 rounded-[8px] border border-rule bg-surface px-6 text-md font-medium text-ink transition-all hover:-translate-y-px hover:border-ink-soft hover:shadow-[var(--shadow-sm)]"
            >
              See how it works
            </a>
          </div>
          <p className="mt-4 font-mono text-xs text-ink-soft">
            No credit card · Free to start · Live in an afternoon
          </p>
        </div>

        {/* floating product graphics */}
        <div className="relative h-[380px]">
          {/* the API-call card */}
          <div
            className="animate-card-rise absolute left-0 top-2 w-[340px] rounded-[14px] border border-rule bg-code-bg p-4 elev-lg"
            style={{ animationDelay: '120ms' }}
          >
            <div className="mb-2 flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-reject/70" />
              <span className="h-2.5 w-2.5 rounded-full bg-pending/70" />
              <span className="h-2.5 w-2.5 rounded-full bg-approve/70" />
              <span className="ml-2 font-mono text-[11px] text-white/40">POST /v1/evaluate</span>
            </div>
            <pre className="overflow-hidden font-mono text-[12px] leading-relaxed text-white/85">
              {`{
  "context": "`}
              <span className="text-code-blue">PAYMENT_APPROVAL</span>
              {`",
  "payload": {
    "amount": `}
              <span className="text-code-green">840000</span>
              {`,
    "vendor": "`}
              <span className="text-code-green">Acme Corp</span>
              {`"
  }
}`}
            </pre>
          </div>

          {/* the verdict card */}
          <div
            className="animate-card-rise absolute right-0 top-40 w-72 rounded-[14px] border border-rule bg-surface/95 p-4 backdrop-blur elev-lg"
            style={{ animationDelay: '320ms' }}
          >
            <div className="flex items-center justify-between">
              <span className="font-mono text-xs text-ink-soft">verdict</span>
              <StampChip label="approval_required" tone="pending" thump />
            </div>
            <div className="mt-3 space-y-1.5 font-mono text-xs text-ink">
              <p>
                ✓ amount &gt; <span className="font-semibold">5,00,000</span> → matched
              </p>
              <p className="text-ink-soft">rule: high-value payment · v3</p>
              <p className="text-ink-soft">workflow: 2-of-3 finance approvers</p>
            </div>
            <div className="mt-3 border-t border-dashed border-rule pt-2 font-mono text-[11px] text-ink-soft">
              p95 latency <span className="text-approve">44ms</span> · trace attached
            </div>
          </div>

          {/* the webhook chip */}
          <div
            className="animate-card-rise absolute bottom-2 left-6 flex items-center gap-2 rounded-[10px] border border-rule bg-surface/95 px-3 py-2 backdrop-blur elev-md"
            style={{ animationDelay: '520ms' }}
          >
            <StampChip label="delivered" tone="approve" />
            <span className="font-mono text-xs text-ink-soft">webhook · 200 · HMAC-signed</span>
          </div>
        </div>
      </div>

      {/* trust strip */}
      <div className="relative z-10 mx-auto mt-20 max-w-6xl">
        <p className="text-center font-mono text-xs uppercase tracking-[0.15em] text-ink-soft/70">
          Built for the systems that move money
        </p>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 font-mono text-sm text-ink-soft">
          <span>◦ Payments</span>
          <span>◦ Procurement</span>
          <span>◦ Lending</span>
          <span>◦ Refunds</span>
          <span>◦ Vendor onboarding</span>
          <span>◦ Access grants</span>
        </div>
      </div>
    </section>
  );
}

/* ─── How it works ───────────────────────────────────────────────────────── */
const STEPS = [
  {
    n: '01',
    title: 'Your system calls the API',
    body: 'Before any business decision, POST the payload to /evaluate with a context. One HTTP call — nothing else in your stack changes.',
    icon: Zap,
  },
  {
    n: '02',
    title: 'The rule engine matches',
    body: 'A JSON condition AST or a decision table decides the outcome deterministically — with a full evaluation trace you can show an auditor.',
    icon: ScrollText,
  },
  {
    n: '03',
    title: 'The workflow routes approvers',
    body: 'Matched rules instantiate an approval workflow: forks, joins, quorums, maker-checker, SLA escalation. Approvers act via API or dashboard.',
    icon: GitBranch,
  },
  {
    n: '04',
    title: 'A signed webhook fires back',
    body: 'The decision returns to your system over an HMAC-signed webhook, delivered reliably. Everything lands in an append-only audit log.',
    icon: Webhook,
  },
];

function HowItWorks(): React.JSX.Element {
  return (
    <section id="how" className="relative px-6 py-24">
      <div className="mx-auto max-w-6xl">
        <div className="mx-auto max-w-2xl text-center">
          <StampChip label="the core loop" tone="brand" />
          <h2 className="mt-4 text-[32px] font-bold tracking-tight text-ink">
            One API call in. A governed decision out.
          </h2>
          <p className="mt-3 text-md text-ink-soft">
            The whole approval lifecycle runs behind a single endpoint — versioned, traced, and
            impossible to silently mutate.
          </p>
        </div>

        <div className="mt-14 grid gap-5 md:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s, i) => {
            const Icon = s.icon;
            return (
              <div
                key={s.n}
                className="card-elevated animate-card-rise relative rounded-[14px] border border-rule bg-surface p-6"
                style={{ animationDelay: `${i * 90}ms` }}
              >
                <div className="flex items-center justify-between">
                  <span
                    className="inline-flex h-10 w-10 items-center justify-center rounded-[10px] text-white"
                    style={{ background: 'var(--brand-grad)', boxShadow: 'var(--glow-brand)' }}
                  >
                    <Icon size={19} />
                  </span>
                  <span className="font-mono text-2xl font-bold text-rule">{s.n}</span>
                </div>
                <h3 className="mt-4 text-md font-semibold text-ink">{s.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-soft">{s.body}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/* ─── Features grid ──────────────────────────────────────────────────────── */
const FEATURES = [
  {
    icon: ScrollText,
    title: 'No-code rule builder',
    body: 'Compose conditions visually — nested AND/OR, numeric ranges, regex, field registry. Draft, test, publish, version. Published rules are immutable.',
  },
  {
    icon: Table2,
    title: 'Decision tables',
    body: 'Prefer a spreadsheet? Author rows with a familiar cell grammar (ranges, IN, wildcards). They compile to the same evaluator as visual rules.',
  },
  {
    icon: GitBranch,
    title: 'Visual workflow engine',
    body: 'Drag out approval graphs: parallel forks, AND-joins, conditional branches, wait steps, auto-approve/reject. Every instance is pinned to a version.',
  },
  {
    icon: Users,
    title: 'Maker-checker, built in',
    body: 'A request creator can never approve their own — even via role membership. Quorums, ad-hoc delegates, and out-of-office cover are first-class.',
  },
  {
    icon: FileSpreadsheet,
    title: 'Immutable audit log',
    body: 'Every state change is an append-only event. A database trigger physically blocks updates and deletes. Show a regulator exactly what happened.',
  },
  {
    icon: Webhook,
    title: 'Reliable signed webhooks',
    body: 'Transactional outbox delivery with exponential backoff and a dead-letter queue. Every payload is HMAC-SHA256 signed with a per-tenant secret.',
  },
  {
    icon: Lock,
    title: 'Multi-tenant from day one',
    body: 'Postgres row-level security under every query, in addition to app-level scoping. A missing tenant filter fails closed — data never leaks across orgs.',
  },
  {
    icon: ShieldCheck,
    title: 'SSO, API keys, rate limits',
    body: 'Google and Microsoft OIDC, scoped API keys, and a sliding-window rate limiter. RBAC on every endpoint, JWT sessions with rotating refresh tokens.',
  },
];

function Features(): React.JSX.Element {
  return (
    <section id="features" className="relative px-6 py-24">
      {/* subtle band */}
      <div
        className="pointer-events-none absolute inset-0 -z-0"
        style={{
          background:
            'radial-gradient(800px 400px at 50% 0%, rgba(29,78,216,0.05), transparent 70%)',
        }}
      />
      <div className="relative z-10 mx-auto max-w-6xl">
        <div className="mx-auto max-w-2xl text-center">
          <StampChip label="the platform" tone="brand" />
          <h2 className="mt-4 text-[32px] font-bold tracking-tight text-ink">
            Everything a governed decision needs
          </h2>
          <p className="mt-3 text-md text-ink-soft">
            The rule engine, the workflow engine, the audit trail, and the delivery layer — one
            platform, one API, one source of truth.
          </p>
        </div>

        <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((f, i) => {
            const Icon = f.icon;
            return (
              <div
                key={f.title}
                className="card-elevated animate-card-rise rounded-[14px] border border-rule bg-surface p-5"
                style={{ animationDelay: `${(i % 4) * 80}ms` }}
              >
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-[8px] bg-brand-bg text-brand">
                  <Icon size={18} />
                </span>
                <h3 className="mt-3 text-md font-semibold text-ink">{f.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-ink-soft">{f.body}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/* ─── Developer section ──────────────────────────────────────────────────── */
function Developers(): React.JSX.Element {
  return (
    <section id="developers" className="relative px-6 py-24">
      <div className="mx-auto grid max-w-6xl items-center gap-12 lg:grid-cols-2">
        <div>
          <StampChip label="for developers" tone="brand" />
          <h2 className="mt-4 text-[32px] font-bold tracking-tight text-ink">
            One endpoint. Idempotent. Traced.
          </h2>
          <p className="mt-3 text-md leading-relaxed text-ink-soft">
            Send an <span className="font-mono text-ink">Idempotency-Key</span> and the same key
            always returns the same decision — safe to retry. The response always carries the
            matched rule, its version, and the full evaluation trace, so you can render <em>why</em>{' '}
            to your own users.
          </p>
          <ul className="mt-6 space-y-3 text-sm text-ink">
            {[
              'OpenAPI spec + Swagger UI out of the box',
              'p95 under 50ms across 1,000 rules (k6-verified)',
              'Zod-validated boundaries — unknown fields rejected',
              'Fails gracefully on missing data — never a 500',
            ].map((t) => (
              <li key={t} className="flex items-start gap-2.5">
                <span className="mt-0.5 text-approve">✓</span>
                {t}
              </li>
            ))}
          </ul>
          <div className="mt-8">
            <Link
              to="/signup"
              className="btn-grad press inline-flex h-11 items-center gap-2 rounded-[8px] px-6 text-md font-medium text-white"
            >
              Get your API key <ArrowRight size={17} />
            </Link>
          </div>
        </div>

        {/* response card */}
        <div className="rounded-[16px] border border-rule bg-code-bg p-5 elev-lg">
          <div className="mb-3 flex items-center gap-1.5 border-b border-white/10 pb-3">
            <span className="h-2.5 w-2.5 rounded-full bg-reject/70" />
            <span className="h-2.5 w-2.5 rounded-full bg-pending/70" />
            <span className="h-2.5 w-2.5 rounded-full bg-approve/70" />
            <span className="ml-2 font-mono text-[11px] text-white/40">200 OK · response</span>
          </div>
          <pre className="overflow-x-auto font-mono text-[12.5px] leading-relaxed text-white/85">
            {`{
  `}
            <span className="text-code-blue">&quot;decision&quot;</span>
            {`: `}
            <span className="text-code-orange">&quot;approval_required&quot;</span>
            {`,
  `}
            <span className="text-code-blue">&quot;matchedRuleId&quot;</span>
            {`: `}
            <span className="text-code-green">&quot;rul_9f3a…&quot;</span>
            {`,
  `}
            <span className="text-code-blue">&quot;matchedRuleVersion&quot;</span>
            {`: `}
            <span className="text-code-green">3</span>
            {`,
  `}
            <span className="text-code-blue">&quot;requestId&quot;</span>
            {`: `}
            <span className="text-code-green">&quot;req_2c11…&quot;</span>
            {`,
  `}
            <span className="text-code-blue">&quot;evaluationTrace&quot;</span>
            {`: [
    { `}
            <span className="text-code-blue">&quot;field&quot;</span>
            {`: `}
            <span className="text-code-green">&quot;amount&quot;</span>
            {`,
      `}
            <span className="text-code-blue">&quot;op&quot;</span>
            {`: `}
            <span className="text-code-green">&quot;GREATER_THAN&quot;</span>
            {`,
      `}
            <span className="text-code-blue">&quot;expected&quot;</span>
            {`: `}
            <span className="text-code-green">500000</span>
            {`,
      `}
            <span className="text-code-blue">&quot;actual&quot;</span>
            {`: `}
            <span className="text-code-green">840000</span>
            {`,
      `}
            <span className="text-code-blue">&quot;result&quot;</span>
            {`: `}
            <span className="text-code-green">true</span>
            {` }
  ]
}`}
          </pre>
        </div>
      </div>
    </section>
  );
}

/* ─── Trust / stats ──────────────────────────────────────────────────────── */
function Stat({
  value,
  suffix,
  label,
}: {
  value: number;
  suffix: string;
  label: string;
}): React.JSX.Element {
  const n = useCountUp(value, { durationMs: 900 });
  return (
    <div className="text-center">
      <p className="text-[40px] font-bold tracking-tight text-grad">
        {n}
        {suffix}
      </p>
      <p className="mt-1 text-sm text-ink-soft">{label}</p>
    </div>
  );
}

function Trust(): React.JSX.Element {
  return (
    <section id="trust" className="relative px-6 py-24">
      <div className="mx-auto max-w-5xl rounded-[20px] border border-rule bg-surface/70 p-12 backdrop-blur elev-md">
        <div className="mx-auto max-w-2xl text-center">
          <StampChip label="engineered to be trusted" tone="approve" />
          <h2 className="mt-4 text-[32px] font-bold tracking-tight text-ink">
            The non-negotiables, enforced by the database
          </h2>
          <p className="mt-3 text-md text-ink-soft">
            Immutability and tenancy aren&apos;t policies you hope developers follow — they&apos;re
            triggers and row-level security the platform can&apos;t bypass.
          </p>
        </div>
        <div className="mt-12 grid grid-cols-2 gap-8 md:grid-cols-4">
          <Stat value={50} suffix="ms" label="p95 evaluate latency" />
          <Stat value={1000} suffix="+" label="rules per tenant, tested" />
          <Stat value={100} suffix="%" label="decisions in the audit log" />
          <Stat value={5} suffix="" label="webhook retry stages" />
        </div>
      </div>
    </section>
  );
}

/* ─── Final CTA ──────────────────────────────────────────────────────────── */
function FinalCta(): React.JSX.Element {
  return (
    <section className="relative overflow-hidden px-6 py-28">
      <div
        className="aurora h-72 w-72"
        style={{ bottom: '-3rem', left: '20%', background: 'var(--brand)' }}
      />
      <div
        className="aurora h-72 w-72"
        style={{ top: '-2rem', right: '15%', background: 'var(--brand-2)', animationDelay: '3s' }}
      />
      <div className="relative z-10 mx-auto max-w-2xl text-center">
        <h2 className="text-[40px] font-bold leading-[1.1] tracking-tight text-ink">
          Put a <span className="text-grad">governed gate</span> in front of every decision.
        </h2>
        <p className="mt-4 text-md text-ink-soft">
          Wire up your first rule and approval flow in an afternoon. No migration, no
          rip-and-replace — just one API call before you act.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link
            to="/signup"
            className="btn-grad press inline-flex h-12 items-center gap-2 rounded-[8px] px-7 text-md font-medium text-white"
          >
            Create your organization <ArrowRight size={18} />
          </Link>
          <Link
            to="/login"
            className="press inline-flex h-12 items-center rounded-[8px] border border-rule bg-surface px-7 text-md font-medium text-ink transition-all hover:-translate-y-px hover:border-ink-soft hover:shadow-[var(--shadow-sm)]"
          >
            Log in
          </Link>
        </div>
      </div>
    </section>
  );
}

/* ─── Footer ─────────────────────────────────────────────────────────────── */
function Footer(): React.JSX.Element {
  return (
    <footer className="border-t border-rule px-6 py-10">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 sm:flex-row">
        <div className="flex items-center gap-3">
          <Wordmark />
          <span className="font-mono text-xs text-ink-soft">approvals as an API</span>
        </div>
        <div className="flex items-center gap-6 font-mono text-xs text-ink-soft">
          <a href="#how" className="hover:text-ink">
            How it works
          </a>
          <a href="#features" className="hover:text-ink">
            Features
          </a>
          <Link to="/login" className="hover:text-ink">
            Log in
          </Link>
          <Link to="/signup" className="hover:text-ink">
            Get started
          </Link>
        </div>
      </div>
      <p className="mx-auto mt-6 max-w-6xl font-mono text-[11px] text-ink-soft/60">
        © {new Date().getFullYear()} ApproveX · You do not need to change your existing application.
      </p>
    </footer>
  );
}

export function LandingPage(): React.JSX.Element {
  return (
    <div className="app-bg min-h-screen">
      <TopNav />
      <main className="relative z-10">
        <Hero />
        <HowItWorks />
        <Features />
        <Developers />
        <Trust />
        <FinalCta />
      </main>
      <Footer />
    </div>
  );
}
