/**
 * Layout primitives (restructure plan §5.4). Screens compose these instead of
 * hand-rolling flex scaffolds — that's what keeps density and hairline rhythm
 * consistent across the app. The shared rules:
 *
 *  - Separation is a 1px `--rule` line or a weight change, never >16px of air.
 *  - Panes are flush: containers own 0 padding on the axis a table/list fills.
 *  - Fixed rails, fluid center. Nothing floats in a centered max-width void.
 */
import { cn } from '../lib/cn';

/* ─── ThreePane ──────────────────────────────────────────────────────────── */

/**
 * Full-height workbench scaffold: fixed left rail, fluid center, optional
 * fixed right rail, hairline-divided. Height defaults to the viewport minus
 * the shell's top padding + page header; override via `className` if a screen
 * carries extra chrome above it.
 */
export function ThreePane({
  left,
  center,
  right,
  leftWidth = 280,
  rightWidth = 320,
  className,
}: {
  left: React.ReactNode;
  center: React.ReactNode;
  right?: React.ReactNode;
  leftWidth?: number;
  rightWidth?: number;
  className?: string;
}): React.JSX.Element {
  return (
    <div
      className={cn(
        'flex h-[calc(100dvh-96px)] min-h-0 overflow-hidden rounded-[10px] border border-rule bg-surface elev-sm',
        className,
      )}
    >
      <aside
        style={{ width: leftWidth }}
        className="flex min-h-0 shrink-0 flex-col overflow-y-auto border-r border-rule"
      >
        {left}
      </aside>
      <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">{center}</section>
      {right !== undefined && (
        <aside
          style={{ width: rightWidth }}
          className="flex min-h-0 shrink-0 flex-col overflow-y-auto border-l border-rule bg-paper/40"
        >
          {right}
        </aside>
      )}
    </div>
  );
}

/* ─── StatStrip ──────────────────────────────────────────────────────────── */

const STAT_TONES = {
  default: 'text-ink',
  approve: 'text-approve',
  pending: 'text-pending',
  reject: 'text-reject',
  brand: 'text-brand',
} as const;

/** 7-day trend, 40×16, drawn in --ink-soft (§4). Pure info, no axes. */
function Sparkline({ points }: { points: number[] }): React.JSX.Element | null {
  if (points.length < 2) return null;
  const max = Math.max(...points, 1);
  const min = Math.min(...points, 0);
  const span = max - min || 1;
  const step = 40 / (points.length - 1);
  const path = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(1)},${(15 - ((p - min) / span) * 14).toFixed(1)}`)
    .join(' ');
  return (
    <svg width="40" height="16" viewBox="0 0 40 16" aria-hidden className="shrink-0">
      <path d={path} fill="none" stroke="var(--ink-soft)" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

interface StatStripItem {
  key: string;
  label: string;
  value: React.ReactNode;
  hint?: string;
  tone?: keyof typeof STAT_TONES;
  /** 7-day trend rendered as a 40×16 sparkline. */
  spark?: number[];
  /** Tiles are filters (§4): clicking toggles, `active` shows the applied one. */
  active?: boolean;
  onClick?: () => void;
}

/**
 * The stat strip (§3.1): a single flush row of tiles divided by hairlines —
 * not floating cards with gaps. ~64px tall, full width, each tile clickable.
 */
export function StatStrip({
  items,
  className,
}: {
  items: StatStripItem[];
  className?: string;
}): React.JSX.Element {
  return (
    <div
      className={cn(
        'mb-3 flex divide-x divide-rule overflow-hidden rounded-[10px] border border-rule bg-surface elev-sm',
        className,
      )}
    >
      {items.map((item) => {
        const Tag = item.onClick ? 'button' : 'div';
        return (
          <Tag
            key={item.key}
            type={item.onClick ? 'button' : undefined}
            onClick={item.onClick}
            className={cn(
              'min-w-0 flex-1 px-3 py-2 text-left',
              item.onClick && 'cursor-pointer transition-colors duration-100 hover:bg-brand-bg/40',
              item.active && 'bg-brand-bg/60 shadow-[inset_0_-2px_0_var(--brand)]',
            )}
          >
            <p className="truncate text-xs font-medium uppercase tracking-[0.08em] text-ink-soft">
              {item.label}
            </p>
            <div className="mt-0.5 flex items-end justify-between gap-2">
              <p
                className={cn(
                  'font-mono text-lg font-bold leading-none',
                  STAT_TONES[item.tone ?? 'default'],
                )}
              >
                {item.value}
              </p>
              {item.spark && <Sparkline points={item.spark} />}
            </div>
            {item.hint && <p className="mt-1 truncate text-xs text-ink-soft">{item.hint}</p>}
          </Tag>
        );
      })}
    </div>
  );
}

/* ─── ContextRail ────────────────────────────────────────────────────────── */

/**
 * The right rail on detail views (§3.2/§4): why this matched, who's next,
 * what happens after. Sections stack with hairlines between; no cards.
 */
export function RailSection({
  title,
  children,
  className,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}): React.JSX.Element {
  return (
    <section className={cn('px-3 py-2.5', className)}>
      <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-[0.08em] text-ink-soft">
        {title}
      </h3>
      {children}
    </section>
  );
}

export function ContextRail({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}): React.JSX.Element {
  return (
    <div className={cn('flex min-h-0 flex-1 flex-col divide-y divide-rule', className)}>
      {children}
    </div>
  );
}

/* ─── KeyboardHintBar ────────────────────────────────────────────────────── */

/** Bottom-right power-user signal (§4): `J/K navigate · A approve · ⌘K search`. */
export function KeyboardHintBar({
  hints,
  className,
}: {
  hints: { keys: string; label: string }[];
  className?: string;
}): React.JSX.Element {
  return (
    <div
      className={cn(
        'pointer-events-none fixed bottom-2 right-3 z-30 hidden items-center gap-3 font-mono text-[11px] text-ink-soft/70 lg:flex',
        className,
      )}
    >
      {hints.map((hint) => (
        <span key={hint.keys}>
          <kbd className="rounded-[3px] border border-rule bg-surface px-1 py-px text-[10px]">
            {hint.keys}
          </kbd>{' '}
          {hint.label}
        </span>
      ))}
    </div>
  );
}
