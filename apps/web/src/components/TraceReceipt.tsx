import type { ScoreBreakdown, TraceEntry } from '@approvex/shared';
import { cn } from '../lib/cn';

const formatValue = (value: unknown): string => {
  if (value === undefined) return 'missing';
  if (typeof value === 'string') return `"${value}"`;
  return JSON.stringify(value);
};

/** Signed, so a mitigating (negative-weight) factor reads as a subtraction. */
const formatSigned = (value: number): string => (value >= 0 ? `+${value}` : `${value}`);

/**
 * The receipt (UI spec §5.4): mono, hairline rules, ✓/✗ per condition with
 * the actual value beside the expected one. A scoring rule prints its factors
 * as a tally instead, totalled against the threshold.
 */
export function TraceReceipt({
  matched,
  matchedLabel,
  trace,
  scoreBreakdown,
  footer,
}: {
  matched: boolean;
  matchedLabel: string;
  trace: TraceEntry[];
  scoreBreakdown?: ScoreBreakdown | null;
  footer?: string;
}): React.JSX.Element {
  // Leaves only, in tree order — logical nodes are visible through indentation.
  // A scoring rule's factor nodes are rendered by the tally below instead.
  const leaves = scoreBreakdown ? [] : trace.filter((entry) => entry.field !== undefined);

  return (
    <div className="animate-receipt rounded-[10px] border border-rule bg-surface p-4 font-mono text-sm leading-6">
      <div className={cn('animate-ink font-semibold', matched ? 'text-approve' : 'text-reject')}>
        {matched ? 'MATCHED' : 'NO MATCH'}
        <span className="ml-3 font-normal text-ink">{matchedLabel}</span>
      </div>
      {/* dashed tear line — the receipt's perforation */}
      <div className="my-2 border-t border-dashed border-rule" />
      {leaves.length === 0 && !scoreBreakdown && (
        <div className="text-ink-soft">No conditions evaluated.</div>
      )}
      {leaves.map((entry, i) => {
        const depth = Math.max(0, (entry.nodePath.match(/\[/g) ?? []).length - 0);
        return (
          <div
            key={entry.nodePath}
            className="animate-line-in flex gap-2"
            style={{ paddingLeft: depth * 12, animationDelay: `${140 + i * 55}ms` }}
          >
            <span className={entry.result ? 'text-approve' : 'text-reject'}>
              {entry.result ? '✓' : '✗'}
            </span>
            <span className="text-ink">
              {entry.field} {entry.operator} {formatValue(entry.expected)}
            </span>
            <span className="text-ink-soft">
              (actual: {formatValue(entry.actual)}
              {entry.notes?.length ? ` → ${entry.notes.join(', ').replace(/_/g, ' ')}` : ''})
            </span>
          </div>
        );
      })}
      {scoreBreakdown && (
        <>
          {scoreBreakdown.factors.map((factor, i) => (
            <div
              key={`${factor.field}-${i}`}
              className="animate-line-in flex justify-between gap-4"
              style={{ animationDelay: `${140 + i * 55}ms` }}
            >
              <span className="truncate text-ink">
                {factor.field}{' '}
                <span className="text-ink-soft">
                  ({formatValue(factor.value)} → {factor.score} × {factor.weight})
                  {factor.notes?.length ? ` ${factor.notes.join(', ').replace(/_/g, ' ')}` : ''}
                </span>
              </span>
              <span className={factor.contribution < 0 ? 'text-approve' : 'text-ink'}>
                {formatSigned(factor.contribution)}
              </span>
            </div>
          ))}
          <div className="my-2 border-t border-dashed border-rule" />
          <div className="flex justify-between font-semibold text-ink">
            <span>
              TOTAL {scoreBreakdown.operator} {scoreBreakdown.threshold}
            </span>
            <span className={matched ? 'text-approve' : 'text-reject'}>{scoreBreakdown.total}</span>
          </div>
        </>
      )}
      {footer && (
        <>
          <div className="my-2 border-t border-dashed border-rule" />
          <div className="animate-ink text-ink" style={{ animationDelay: '200ms' }}>
            {footer}
          </div>
        </>
      )}
    </div>
  );
}
