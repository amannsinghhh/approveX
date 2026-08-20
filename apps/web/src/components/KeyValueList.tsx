import { useState } from 'react';
import { formatINR } from '../lib/format';

/**
 * Payload as a two-column key/value ledger (UI spec §5.1): keys in ink-soft,
 * values in mono. A {} toggle reveals formatted JSON for developers.
 */
export function KeyValueList({ data }: { data: Record<string, unknown> }): React.JSX.Element {
  const [showJson, setShowJson] = useState(false);
  const entries = Object.entries(data);

  return (
    <div className="rounded-[10px] border border-rule bg-surface">
      <div className="flex items-center justify-between border-b border-rule px-3 py-1.5">
        <span className="text-sm font-medium text-ink-soft">Submitted data</span>
        <button
          type="button"
          onClick={() => setShowJson((prev) => !prev)}
          aria-label={showJson ? 'Show as table' : 'Show as JSON'}
          className="rounded px-1.5 font-mono text-sm text-ink-soft hover:text-ink"
        >
          {'{}'}
        </button>
      </div>
      {showJson ? (
        <pre className="overflow-x-auto p-3 font-mono text-sm leading-5 text-ink">
          {JSON.stringify(data, null, 2)}
        </pre>
      ) : (
        <dl>
          {entries.length === 0 && (
            <p className="px-3 py-3 text-sm text-ink-soft">Empty payload.</p>
          )}
          {entries.map(([key, value]) => (
            <div
              key={key}
              className="flex items-baseline justify-between gap-4 border-b border-rule px-3 py-1.5 last:border-b-0"
            >
              <dt className="text-sm text-ink-soft">{key}</dt>
              <dd className="max-w-[60%] truncate text-right font-mono text-sm text-ink">
                {key === 'amount' && typeof value === 'number'
                  ? formatINR(value)
                  : typeof value === 'object'
                    ? JSON.stringify(value)
                    : String(value)}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
