/**
 * SLA meter (UI spec §5.1): a 3px bar along a card's bottom edge that fills
 * as due_at approaches — amber in the last 25%, red when breached. Makes
 * escalation risk visible without reading a single word.
 */
export function SlaMeter({
  createdAt,
  dueAt,
}: {
  createdAt: string;
  dueAt: string | null;
}): React.JSX.Element | null {
  if (!dueAt) return null;
  const start = Date.parse(createdAt);
  const end = Date.parse(dueAt);
  const now = Date.now();
  const fraction = end > start ? Math.min((now - start) / (end - start), 1) : 1;
  const breached = now > end;
  const color = breached
    ? 'var(--stamp-reject)'
    : fraction > 0.75
      ? 'var(--stamp-pending)'
      : 'var(--brand)';

  return (
    <div
      aria-label={breached ? 'SLA breached' : `SLA ${Math.round(fraction * 100)}% elapsed`}
      className="absolute inset-x-0 bottom-0 h-[3px] overflow-hidden rounded-b-[10px] bg-rule/50"
    >
      <div
        className={breached ? 'sla-breach h-full' : 'h-full transition-[width] duration-500'}
        style={{ width: `${fraction * 100}%`, background: color }}
      />
    </div>
  );
}
