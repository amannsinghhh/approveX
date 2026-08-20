/**
 * Portal landing (/submit): pick what you're submitting. One card per context
 * that has at least one user-submittable field. Clicking a card opens the
 * generated form at /submit/:context.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { PageHeader } from '../components/AppShell';
import { Card } from '../components/ui';
import { EmptyState } from '../components/EmptyState';
import { api } from '../lib/api';
import type { PortalContext } from '../lib/types';

export function SubmitLandingPage(): React.JSX.Element {
  const [items, setItems] = useState<PortalContext[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await api<{ items: PortalContext[] }>('/portal/contexts');
        if (!cancelled) {
          setItems(res.items);
          setError(null);
        }
      } catch {
        if (!cancelled) setError("Couldn't load submission types. Check your connection and retry.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      <PageHeader
        title="New request"
        subtitle="Pick what you're submitting — the right approval flow is chosen for you."
      />

      {error && <p className="mb-3 text-sm text-reject">{error}</p>}

      {loading ? (
        <p className="text-sm text-ink-soft">Loading…</p>
      ) : items.length === 0 ? (
        <EmptyState
          headline="Nothing to submit yet"
          body="An admin hasn't marked any fields as user-submittable. Once they do, the submission types show up here."
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {items.map((item) => (
            <Link
              key={item.context}
              to={`/submit/${encodeURIComponent(item.context)}`}
              className="press block"
            >
              <Card className="flex items-center justify-between gap-3 px-4 py-3 transition-shadow duration-150 hover:elev-md">
                <div className="min-w-0">
                  <p className="truncate font-mono text-sm font-semibold text-ink">
                    {item.context}
                  </p>
                  <p className="mt-0.5 text-xs text-ink-soft">
                    {item.fieldCount} field{item.fieldCount === 1 ? '' : 's'}
                  </p>
                </div>
                <ArrowRight size={16} className="shrink-0 text-ink-soft" />
              </Card>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
