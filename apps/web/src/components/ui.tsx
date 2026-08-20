/**
 * Styled primitives (UI spec §2, §6): 36px form fields, 6px radius, borders
 * over shadows, sentence case, buttons say what they do.
 */
import { forwardRef } from 'react';
import { cn } from '../lib/cn';

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

const BUTTON_STYLES: Record<ButtonVariant, string> = {
  primary: 'btn-grad text-white',
  secondary:
    'bg-surface text-ink border border-rule hover:border-ink-soft hover:shadow-[var(--shadow-sm)]',
  danger: 'bg-surface text-reject border border-rule hover:border-reject',
  ghost: 'bg-transparent text-ink-soft border border-transparent hover:text-ink',
};

export const Button = forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }
>(function Button({ className, variant = 'secondary', type, ...props }, ref) {
  return (
    <button
      ref={ref}
      type={type ?? 'button'}
      className={cn(
        // Density scale (§2): 32px buttons, 28px for ghost/icon buttons.
        'press inline-flex items-center gap-1.5 rounded-[6px] px-2.5 text-sm font-medium',
        variant === 'ghost' ? 'h-7' : 'h-8',
        'transition-[color,background-color,border-color,transform,box-shadow] duration-150 ease-out',
        'disabled:cursor-not-allowed disabled:opacity-50 disabled:active:transform-none',
        BUTTON_STYLES[variant],
        className,
      )}
      {...props}
    />
  );
});

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return (
      <input
        ref={ref}
        className={cn(
          'h-control w-full rounded-[6px] border border-rule bg-surface px-2 text-base text-ink',
          'placeholder:text-ink-soft/60 transition-colors duration-150 hover:border-ink-soft/50',
          className,
        )}
        {...props}
      />
    );
  },
);

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      className={cn(
        'w-full rounded-[6px] border border-rule bg-surface px-2 py-1.5 text-base text-ink',
        'placeholder:text-ink-soft/60 transition-colors duration-150 hover:border-ink-soft/50',
        className,
      )}
      {...props}
    />
  );
});

export const Select = forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, ...props }, ref) {
    return (
      <select
        ref={ref}
        className={cn(
          'select-caret h-control rounded-[6px] border border-rule bg-surface pl-2 pr-7 text-base text-ink',
          'transition-colors duration-150 hover:border-ink-soft/50',
          className,
        )}
        {...props}
      />
    );
  },
);

export function Label({
  className,
  ...props
}: React.LabelHTMLAttributes<HTMLLabelElement>): React.JSX.Element {
  return (
    <label className={cn('mb-1 block text-sm font-medium text-ink-soft', className)} {...props} />
  );
}

export function Card({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return (
    <div
      className={cn('rounded-[10px] border border-rule bg-surface elev-sm', className)}
      {...props}
    />
  );
}

const STAT_TONE_TEXT = {
  default: 'text-ink',
  approve: 'text-approve',
  pending: 'text-pending',
  brand: 'text-brand',
} as const;

/**
 * Big-number stat tile. List pages open with the figures people actually scan
 * for — the page reads as a workbench, not a bare table floating in space.
 */
export function StatTile({
  label,
  value,
  hint,
  tone = 'default',
  className,
  style,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  tone?: keyof typeof STAT_TONE_TEXT;
  className?: string;
  style?: React.CSSProperties;
}): React.JSX.Element {
  return (
    <Card
      className={cn('card-elevated animate-card-rise min-w-0 flex-1 px-3 py-2', className)}
      style={style}
    >
      <p className="truncate text-xs font-medium uppercase tracking-[0.08em] text-ink-soft">
        {label}
      </p>
      <p className={cn('mt-0.5 font-mono text-lg font-bold leading-none', STAT_TONE_TEXT[tone])}>
        {value}
      </p>
      {hint && <p className="mt-1 truncate text-xs text-ink-soft">{hint}</p>}
    </Card>
  );
}

/** ALL / ANY style segmented control. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  className,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  className?: string;
}): React.JSX.Element {
  return (
    <div
      role="radiogroup"
      className={cn('inline-flex rounded-[6px] border border-rule bg-paper p-0.5', className)}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            'rounded-[4px] px-2.5 py-1 text-sm font-medium transition-colors duration-150',
            value === option.value
              ? 'bg-surface font-semibold text-brand shadow-[inset_0_0_0_1.5px_var(--brand)]'
              : 'text-ink-soft hover:text-ink',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Tabs<T extends string>({
  value,
  tabs,
  onChange,
}: {
  value: T;
  tabs: { value: T; label: string }[];
  onChange: (value: T) => void;
}): React.JSX.Element {
  return (
    <div role="tablist" className="flex gap-4 border-b border-rule">
      {tabs.map((tab) => (
        <button
          key={tab.value}
          role="tab"
          type="button"
          aria-selected={value === tab.value}
          onClick={() => onChange(tab.value)}
          className={cn(
            '-mb-px border-b-2 pb-1.5 text-base font-medium transition-colors duration-150',
            value === tab.value
              ? 'border-brand text-ink'
              : 'border-transparent text-ink-soft hover:text-ink',
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
