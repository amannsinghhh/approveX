/**
 * Part A setup checklist (guided-UI layer): lives in the AppShell sidebar
 * footer and walks a new tenant through the core loop — define fields, publish
 * a rule, publish a workflow, run a request. Items are driven by real tenant
 * state (re-checked on navigation), and the card disappears once everything is
 * done or the user dismisses it (persisted per-user via /me/settings).
 */
import { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { CheckCircle2, Circle, X } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { cn } from '../lib/cn';

const DISMISS_KEY = 'setupChecklistDismissed';

interface ChecklistItem {
  id: string;
  label: string;
  to: string;
  done: boolean;
}

export function SetupChecklist(): React.JSX.Element | null {
  const { me, setSetting } = useAuth();
  const location = useLocation();
  const [items, setItems] = useState<ChecklistItem[] | null>(null);

  const dismissed = me?.settings?.[DISMISS_KEY] === true;

  useEffect(() => {
    if (!me || dismissed) return;
    let cancelled = false;
    void (async () => {
      const results = await Promise.allSettled([
        api<{ items: unknown[] }>('/fields'),
        api<{ total: number }>('/rules?status=published&page=1&pageSize=1'),
        api<{ total: number }>('/workflows?status=published&page=1&pageSize=1'),
        api<{ total: number }>('/requests?page=1&pageSize=1'),
      ]);
      // A failed probe (e.g. missing permission) simply reads as "not done yet".
      const count = (
        result: PromiseSettledResult<{ total?: number; items?: unknown[] }>,
      ): number =>
        result.status === 'fulfilled'
          ? (result.value.total ?? result.value.items?.length ?? 0)
          : 0;
      if (cancelled) return;
      setItems([
        { id: 'fields', label: 'Define a business field', to: '/fields', done: count(results[0]) > 0 },
        { id: 'rule', label: 'Publish a rule', to: '/rules', done: count(results[1]) > 0 },
        { id: 'workflow', label: 'Publish a workflow', to: '/workflows', done: count(results[2]) > 0 },
        { id: 'request', label: 'Run your first request', to: '/sandbox', done: count(results[3]) > 0 },
      ]);
    })();
    return () => {
      cancelled = true;
    };
  }, [me, dismissed, location.pathname]);

  if (!me || dismissed || !items) return null;
  const doneCount = items.filter((item) => item.done).length;
  if (doneCount === items.length) return null;

  return (
    <div className="mb-3 rounded-[6px] border border-rule bg-paper px-2.5 py-2">
      <div className="mb-1 flex items-center justify-between">
        <p className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-soft">
          Setup {doneCount}/{items.length}
        </p>
        <button
          type="button"
          aria-label="Dismiss setup checklist"
          onClick={() => void setSetting(DISMISS_KEY, true)}
          className="rounded-[4px] p-0.5 text-ink-soft/70 transition-colors hover:text-ink"
        >
          <X size={12} />
        </button>
      </div>
      {items.map((item) => (
        <NavLink
          key={item.id}
          to={item.to}
          className="flex h-6 items-center gap-1.5 text-sm transition-colors"
        >
          {item.done ? (
            <CheckCircle2 size={13} className="shrink-0 text-approve" />
          ) : (
            <Circle size={13} className="shrink-0 text-ink-soft/50" />
          )}
          <span
            className={cn(
              'truncate',
              item.done ? 'text-ink-soft/60 line-through' : 'text-ink-soft hover:text-ink',
            )}
          >
            {item.label}
          </span>
        </NavLink>
      ))}
    </div>
  );
}
