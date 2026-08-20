/**
 * SSO landing: the API redirects here with tokens (or an error) in the URL
 * fragment — fragments never reach a server log. Store and go.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Wordmark } from '../components/AppShell';
import { Card } from '../components/ui';
import { tokens } from '../lib/api';

export function AuthCallbackPage(): React.JSX.Element {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.slice(1));
    const failure = params.get('error');
    const accessToken = params.get('access_token');
    const refreshToken = params.get('refresh_token');
    if (failure || !accessToken || !refreshToken) {
      setError(failure ?? 'The identity provider returned no session');
      return;
    }
    tokens.set({ accessToken, refreshToken });
    // Full reload so AuthProvider boots with the new session (and the tokens
    // vanish from the address bar).
    window.location.replace('/inbox');
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-paper">
      <Card className="w-[400px] p-8 text-center">
        <div className="mb-4 flex justify-center">
          <Wordmark />
        </div>
        {error ? (
          <>
            <p className="text-base text-reject">Sign-in failed: {error}</p>
            <p className="mt-3 text-sm text-ink-soft">
              <Link to="/login" className="text-brand hover:text-brand-ink">
                Back to sign in
              </Link>
            </p>
          </>
        ) : (
          <p className="font-mono text-sm text-ink-soft">completing sign-in…</p>
        )}
      </Card>
    </div>
  );
}
