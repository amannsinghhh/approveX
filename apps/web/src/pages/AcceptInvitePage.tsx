/**
 * Invitation landing (Phase 7): the link the wizard (or an admin) sends to an
 * approver. Token in the URL, name + password here, straight into the inbox.
 */
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Wordmark } from '../components/AppShell';
import { Button, Card, Input, Label } from '../components/ui';
import { api, ApiError, tokens } from '../lib/api';

export function AcceptInvitePage(): React.JSX.Element {
  const [params] = useSearchParams();
  const token = useMemo(() => params.get('token') ?? '', [params]);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const accepted = await api<{ user: { email: string } }>('/auth/accept-invitation', {
        method: 'POST',
        body: { token, name, password },
      });
      const session = await api<{ accessToken: string; refreshToken: string }>('/auth/login', {
        method: 'POST',
        body: { email: accepted.user.email, password },
      });
      tokens.set(session);
      window.location.replace('/inbox');
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Could not accept the invitation. Ask for a fresh link.',
      );
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-paper">
      <Card className="w-[400px] p-8">
        <div className="mb-2 flex justify-center">
          <Wordmark />
        </div>
        <p className="mb-6 text-center text-sm text-ink-soft">
          You’ve been invited to approve requests. Set up your account to get started.
        </p>
        {!token ? (
          <p className="text-center text-sm text-reject">
            This link is missing its invitation token — ask for a fresh one.
          </p>
        ) : (
          <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
            <div>
              <Label htmlFor="invite-name">Your name</Label>
              <Input
                id="invite-name"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="invite-password">Password</Label>
              <Input
                id="invite-password"
                type="password"
                minLength={8}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            {error && <p className="text-sm text-reject">{error}</p>}
            <Button type="submit" variant="primary" disabled={busy} className="justify-center">
              {busy ? 'Joining…' : 'Join and open my inbox'}
            </Button>
          </form>
        )}
        <p className="mt-4 text-center text-sm text-ink-soft">
          Already have an account?{' '}
          <Link to="/login" className="text-brand hover:text-brand-ink">
            Sign in
          </Link>
        </p>
      </Card>
    </div>
  );
}
