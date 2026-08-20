import { useState } from 'react';
import { cn } from '../lib/cn';

/** Truncated ID in mono with copy-on-click (UI spec §6). */
export function MonoId({
  value,
  className,
}: {
  value: string;
  className?: string;
}): React.JSX.Element {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      title={value}
      onClick={() => {
        void navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
      className={cn(
        'font-mono text-sm text-ink-soft transition-colors duration-150 hover:text-ink',
        className,
      )}
    >
      {copied ? 'copied' : `${value.slice(0, 8)}…`}
    </button>
  );
}
