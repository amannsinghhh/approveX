import { StampChip, type StampTone } from './StampChip';

/** Empty states teach the product (UI spec §6): headline + one sentence + one action. */
export function EmptyState({
  stamp,
  stampTone = 'neutral',
  headline,
  body,
  action,
}: {
  stamp?: string;
  stampTone?: StampTone;
  headline: string;
  body: string;
  action?: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="animate-fade flex flex-col items-center gap-3 py-10 text-center">
      {stamp && <StampChip label={stamp} tone={stampTone} thump className="scale-125" />}
      <div className="animate-ink" style={{ animationDelay: '120ms' }}>
        <h3 className="text-md font-bold text-ink">{headline}</h3>
        <p className="mt-1 max-w-md text-base text-ink-soft">{body}</p>
      </div>
      {action}
    </div>
  );
}
