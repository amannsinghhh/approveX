import { cn } from '../lib/cn';

interface LedgerColumn<T> {
  key: string;
  header: string;
  render: (row: T) => React.ReactNode;
  /** Right-align (amounts, counts). Numbers are always right-aligned. */
  numeric?: boolean;
  className?: string;
}

/**
 * The ledger (UI spec §1): dense rows, hairline rules, 40px row height,
 * sentence-case headers. Ships loading + empty states (§6 — no exceptions).
 */
export function LedgerTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  loading = false,
  empty,
  flush = false,
}: {
  columns: LedgerColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  loading?: boolean;
  empty?: React.ReactNode;
  /** Fill a framed pane edge-to-edge (§3.5): no border wrapper, sticky header. */
  flush?: boolean;
}): React.JSX.Element {
  return (
    <div
      className={cn(
        flush
          ? 'min-h-0 flex-1 overflow-auto'
          : 'overflow-x-auto rounded-[10px] border border-rule bg-surface',
      )}
    >
      {/* Density scale (§2): 13px table text, 36px rows, 8/12px cell padding. */}
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-rule">
            {columns.map((column) => (
              <th
                key={column.key}
                className={cn(
                  'h-8 px-3 text-left text-xs font-medium uppercase tracking-[0.06em] text-ink-soft',
                  // Collapsed borders don't stick with the header; an inset
                  // shadow keeps the hairline under the sticky row.
                  flush && 'sticky top-0 z-10 bg-surface shadow-[inset_0_-1px_0_var(--rule)]',
                  column.numeric && 'text-right',
                  column.className,
                )}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading &&
            Array.from({ length: 8 }).map((_, i) => (
              <tr key={`skeleton-${i}`} className="border-b border-rule last:border-b-0">
                {columns.map((column) => (
                  <td key={column.key} className="h-9 px-3">
                    <div
                      className="shimmer h-3 w-3/4 rounded bg-rule/60"
                      style={{ animationDelay: `${i * 90}ms` }}
                    />
                  </td>
                ))}
              </tr>
            ))}
          {!loading &&
            rows.map((row, i) => (
              <tr
                key={rowKey(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={cn(
                  'animate-ledger-in border-b border-rule even:bg-paper/40 last:border-b-0',
                  onRowClick && 'cursor-pointer transition-colors duration-100 hover:bg-brand-bg/40',
                )}
                // Stagger settles rows top-to-bottom like sheets stacking; cap
                // the delay so long tables don't feel sluggish.
                style={{ animationDelay: `${Math.min(i, 12) * 28}ms` }}
              >
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={cn(
                      'h-9 px-3 py-1.5',
                      column.numeric && 'text-right font-mono',
                      column.className,
                    )}
                  >
                    {column.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          {!loading && rows.length === 0 && (
            <tr>
              <td colSpan={columns.length} className="px-3 py-12">
                {empty}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
