/**
 * Part A teaching strip (guided-UI layer): a dismissible, brand-accented banner
 * that explains a concept in plain language. Dismissal is per-user and durable —
 * it persists to /me/settings under `dismissedConcepts`, so once a user closes a
 * strip it stays closed on every device.
 */
import { X } from 'lucide-react';
import { useAuth } from '../lib/auth';

const DISMISS_KEY = 'dismissedConcepts';

export function ConceptStrip({
  id,
  title,
  children,
}: {
  /** Stable id used as the per-user dismissal key. */
  id: string;
  title: string;
  children: React.ReactNode;
}): React.JSX.Element | null {
  const { me, setSetting } = useAuth();
  const dismissed = (me?.settings?.[DISMISS_KEY] as Record<string, boolean> | undefined) ?? {};
  if (dismissed[id]) return null;

  const dismiss = (): void => {
    void setSetting(DISMISS_KEY, { ...dismissed, [id]: true });
  };

  return (
    <div className="mb-4 flex items-start gap-3 rounded-[6px] border border-brand/40 bg-brand-bg px-4 py-3">
      <div className="flex-1">
        <p className="text-sm font-semibold text-brand">{title}</p>
        <p className="mt-0.5 text-sm leading-5 text-ink">{children}</p>
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className="rounded-[4px] p-1 text-ink-soft transition-colors hover:bg-brand/10 hover:text-ink"
      >
        <X size={15} />
      </button>
    </div>
  );
}
