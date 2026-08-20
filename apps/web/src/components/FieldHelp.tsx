import { cn } from '../lib/cn';

/**
 * Part A helper line (guided-UI layer): one quiet sentence beneath an input
 * that says what the value means in business terms. Static by design — no
 * tooltips to hover-hunt for.
 */
export function FieldHelp({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <p className={cn('mt-0.5 max-w-md text-xs leading-4 text-ink-soft', className)}>{children}</p>
  );
}
