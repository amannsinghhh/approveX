import { cn } from '../lib/cn';

export type StampTone = 'approve' | 'reject' | 'pending' | 'neutral' | 'brand';

const TONE_STYLES: Record<StampTone, string> = {
  approve: 'text-approve border-approve bg-approve-bg',
  reject: 'text-reject border-reject bg-reject-bg',
  pending: 'text-pending border-pending bg-pending-bg',
  neutral: 'text-neutral border-neutral bg-neutral-bg',
  brand: 'text-brand border-brand bg-brand-bg',
};

const STATUS_TONE: Record<string, StampTone> = {
  approved: 'approve',
  published: 'approve',
  active: 'approve',
  rejected: 'reject',
  expired: 'reject',
  pending: 'pending',
  draft: 'neutral',
  archived: 'neutral',
  cancelled: 'neutral',
  deactivated: 'neutral',
};

/**
 * The signature element (UI spec §4): uppercase mono, 1.5px border, 2px
 * radius, faint -1° rotation. `thump` plays the single 240ms landing
 * animation — the only deliberate motion in the product.
 */
export function StampChip({
  label,
  tone,
  thump = false,
  className,
}: {
  label: string;
  tone?: StampTone;
  thump?: boolean;
  className?: string;
}): React.JSX.Element {
  const resolved = tone ?? STATUS_TONE[label.toLowerCase()] ?? 'neutral';
  return (
    <span
      className={cn(
        'inline-block rounded-[2px] border-[1.5px] px-1.5 py-px font-mono text-[11px] font-medium uppercase tracking-[0.08em]',
        '-rotate-1',
        TONE_STYLES[resolved],
        thump && 'stamp-thump',
        className,
      )}
    >
      {label}
    </span>
  );
}
