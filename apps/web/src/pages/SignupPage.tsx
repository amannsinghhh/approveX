import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Wordmark } from '../components/AppShell';
import { Button, Card, Input, Label } from '../components/ui';
import { ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';

export function SignupPage(): React.JSX.Element {
  const { signup } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ tenantName: '', name: '', email: '', password: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((prev) => ({ ...prev, [key]: e.target.value }));

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signup(form);
      navigate('/welcome');
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 409
          ? err.message
          : 'Could not create the organization. Check the fields and try again.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-paper">
      <Card className="w-[400px] p-8">
        <div className="mb-6 flex justify-center">
          <Wordmark />
        </div>
        <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
          <div>
            <Label htmlFor="tenantName">Organization name</Label>
            <Input id="tenantName" required value={form.tenantName} onChange={set('tenantName')} />
          </div>
          <div>
            <Label htmlFor="name">Your name</Label>
            <Input id="name" required value={form.name} onChange={set('name')} />
          </div>
          <div>
            <Label htmlFor="email">Work email</Label>
            <Input id="email" type="email" required value={form.email} onChange={set('email')} />
          </div>
          <div>
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              minLength={8}
              required
              value={form.password}
              onChange={set('password')}
            />
          </div>
          {error && <p className="text-sm text-reject">{error}</p>}
          <Button type="submit" variant="primary" disabled={busy} className="justify-center">
            {busy ? 'Creating…' : 'Create organization'}
          </Button>
        </form>
        <p className="mt-4 text-center text-sm text-ink-soft">
          Already set up?{' '}
          <Link to="/login" className="text-brand hover:text-brand-ink">
            Sign in
          </Link>
        </p>
      </Card>
    </div>
  );
}
