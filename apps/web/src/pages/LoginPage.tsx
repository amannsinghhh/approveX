import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Wordmark } from '../components/AppShell';
import { StampChip } from '../components/StampChip';
import { Button, Card, Input, Label } from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';

interface SsoProvider {
  id: string;
  label: string;
}

/** Floating product-moment cards that drift behind the brand panel. */
function BrandPanel(): React.JSX.Element {
  return (
    <div className="relative hidden overflow-hidden lg:flex lg:w-[52%] lg:flex-col lg:justify-between lg:p-12">
      {/* aurora backdrop */}
      <div
        className="aurora h-72 w-72"
        style={{ top: '-4rem', left: '-3rem', background: 'var(--brand)' }}
      />
      <div
        className="aurora h-80 w-80"
        style={{
          bottom: '-5rem',
          right: '2rem',
          background: 'var(--brand-2)',
          animationDelay: '3s',
        }}
      />
      <div
        className="aurora h-64 w-64"
        style={{
          top: '35%',
          right: '-3rem',
          background: 'var(--stamp-approve)',
          opacity: 0.35,
          animationDelay: '6s',
        }}
      />

      <div className="relative z-10">
        <Wordmark />
      </div>

      <div className="relative z-10 max-w-md">
        <h1 className="text-[34px] font-bold leading-[1.15] tracking-tight text-ink">
          Approvals, <span className="text-grad">enforced</span> and{' '}
          <span className="text-grad">explained.</span>
        </h1>
        <p className="mt-3 text-md text-ink-soft">
          Your systems ask ApproveX before money moves. Finance owns the rules — every decision
          leaves an immutable, signed trail.
        </p>

        {/* floating product graphics */}
        <div className="relative mt-10 h-44">
          <div
            className="animate-card-rise absolute left-0 top-0 w-64 rounded-[12px] border border-rule bg-surface/90 p-3 backdrop-blur elev-lg"
            style={{ animationDelay: '150ms' }}
          >
            <div className="flex items-center justify-between">
              <span className="font-mono text-xs text-ink-soft">PAYMENT_APPROVAL</span>
              <StampChip label="approved" tone="approve" thump />
            </div>
            <p className="mt-2 font-mono text-sm text-ink">
              ✓ amount &gt; <span className="font-semibold">5,00,000</span>
            </p>
            <p className="font-mono text-xs text-ink-soft">actual: 8,40,000 → matched</p>
          </div>
          <div
            className="animate-card-rise absolute right-2 top-24 flex items-center gap-2 rounded-[10px] border border-rule bg-surface/90 px-3 py-2 backdrop-blur elev-md"
            style={{ animationDelay: '340ms' }}
          >
            <StampChip label="delivered" tone="approve" />
            <span className="font-mono text-xs text-ink-soft">webhook · 200 · 1.2s</span>
          </div>
        </div>
      </div>

      <div className="relative z-10 flex gap-6 font-mono text-xs text-ink-soft">
        <span>▪ p95 &lt; 50ms</span>
        <span>▪ HMAC-signed</span>
        <span>▪ append-only audit</span>
      </div>
    </div>
  );
}

export function LoginPage(): React.JSX.Element {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [providers, setProviders] = useState<SsoProvider[]>([]);

  // SSO buttons appear only when the deployment has providers configured.
  useEffect(() => {
    api<{ providers: SsoProvider[] }>('/auth/oidc/providers')
      .then((res) => setProviders(res.providers))
      .catch(() => setProviders([]));
  }, []);

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
      navigate('/rules');
    } catch {
      setError('Email or password is incorrect. Check both and try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="app-bg flex min-h-screen">
      <BrandPanel />

      {/* form column */}
      <div className="relative z-10 flex flex-1 items-center justify-center px-6 py-10">
        <Card className="animate-card-rise w-[400px] max-w-full border-rule/70 bg-surface/95 p-8 backdrop-blur elev-lg">
          <div className="mb-1 flex justify-center lg:hidden">
            <Wordmark />
          </div>
          <div className="mb-6 text-center">
            <h2 className="text-lg font-bold tracking-tight text-ink">Welcome back</h2>
            <p className="mt-0.5 text-sm text-ink-soft">Sign in to your workspace.</p>
          </div>
          <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
            <div>
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            {error && <p className="text-sm text-reject">{error}</p>}
            <Button
              type="submit"
              variant="primary"
              disabled={busy}
              className="h-10 justify-center text-md"
            >
              {busy ? 'Signing in…' : 'Sign in →'}
            </Button>
          </form>
          {providers.length > 0 && (
            <>
              <div className="my-4 flex items-center gap-3">
                <span className="h-px flex-1 bg-rule" />
                <span className="text-xs uppercase tracking-wide text-ink-soft">or</span>
                <span className="h-px flex-1 bg-rule" />
              </div>
              <div className="flex flex-col gap-2">
                {providers.map((provider) => (
                  <a
                    key={provider.id}
                    href={`/api/v1/auth/oidc/${provider.id}/start`}
                    className="inline-flex h-9 items-center justify-center rounded-[6px] border border-rule bg-surface px-3 text-base font-medium text-ink transition-all duration-150 hover:-translate-y-px hover:border-ink-soft hover:shadow-[var(--shadow-sm)]"
                  >
                    Continue with {provider.label}
                  </a>
                ))}
              </div>
            </>
          )}
          <p className="mt-4 text-center text-sm text-ink-soft">
            New here?{' '}
            <Link to="/signup" className="font-medium text-brand hover:text-brand-ink">
              Create an organization
            </Link>
          </p>
        </Card>
      </div>
    </div>
  );
}
