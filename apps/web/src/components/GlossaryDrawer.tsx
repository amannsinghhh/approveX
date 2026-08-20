/**
 * Part A glossary (guided-UI layer): a "?" trigger that slides in a right-hand
 * drawer defining every product term in one plain sentence. Overlay behaviour
 * (backdrop click / Escape to close) mirrors CommandPalette.
 */
import { useEffect, useState } from 'react';
import { CircleHelp, X } from 'lucide-react';

const TERMS: { term: string; definition: string }[] = [
  {
    term: 'Rule',
    definition:
      'A published condition that ApproveX checks every time your system calls POST /evaluate for its context.',
  },
  {
    term: 'Condition',
    definition:
      'One field + operator + value test. Groups combine conditions with ALL (every one must hold) or ANY (one is enough).',
  },
  {
    term: 'Context',
    definition:
      'The uppercase string your system sends with an evaluation (e.g. PAYMENT_APPROVAL) so only the relevant rules run.',
  },
  {
    term: 'Priority',
    definition:
      'When several rules match, the lowest priority number wins; remaining ties go to the rule with more conditions.',
  },
  {
    term: 'Decision table',
    definition:
      'A grid of rules: each row is a set of cell conditions and the outputs to emit when they match.',
  },
  {
    term: 'Hit policy',
    definition:
      'Which matching rows of a decision table fire: first (top match), all, best (highest row priority), or unique (rows may never overlap).',
  },
  {
    term: 'Managed list',
    definition:
      'A named list of values (e.g. VIP customers) that rules reference with IN LIST — edit the list any time without republishing rules.',
  },
  {
    term: 'Workflow',
    definition:
      'The approval steps that start when a rule matches in execute mode — who approves, in what order, with what deadlines.',
  },
  {
    term: 'Binding',
    definition:
      'The link from a rule version to the workflow it starts. Rebind after publishing a new rule version.',
  },
  {
    term: 'Version',
    definition:
      'Publishing freezes a rule, table or workflow version forever; editing afterwards creates the next version. Running requests stay pinned to the version they started with.',
  },
  {
    term: 'Quorum',
    definition:
      'How many members of the assigned role must approve a step: any one, all of them, or a fixed number.',
  },
  {
    term: 'Maker-checker',
    definition:
      'Whoever created a request can never approve it — another role member must, or the step escalates.',
  },
  {
    term: 'Sandbox / dry run',
    definition:
      'Evaluate a payload against your published rules without creating a request or starting any workflow.',
  },
  {
    term: 'Webhook',
    definition:
      'A signed HTTP callback ApproveX sends to your system when a request is decided, so your app can act on the outcome.',
  },
];

export function GlossaryDrawer(): React.JSX.Element {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open glossary"
        title="What do these words mean?"
        className="flex items-center gap-1 rounded-[4px] p-1 font-mono text-[10px] uppercase tracking-[0.08em] text-ink-soft/70 transition-colors hover:text-ink"
      >
        <CircleHelp size={13} /> Glossary
      </button>

      {open && (
        <div
          className="animate-fade fixed inset-0 z-50 bg-ink/20 backdrop-blur-[1px]"
          onClick={() => setOpen(false)}
        >
          <aside
            role="dialog"
            aria-label="Glossary"
            className="animate-pop fixed inset-y-0 right-0 flex w-[400px] flex-col border-l border-rule bg-surface shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="flex h-12 items-center justify-between border-b border-rule px-4">
              <h2 className="text-base font-bold text-ink">Glossary</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close glossary"
                className="rounded-[4px] p-1 text-ink-soft transition-colors hover:text-ink"
              >
                <X size={15} />
              </button>
            </header>
            <dl className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
              {TERMS.map(({ term, definition }) => (
                <div key={term} className="border-b border-rule py-2.5 last:border-b-0">
                  <dt className="text-sm font-semibold text-ink">{term}</dt>
                  <dd className="mt-0.5 text-sm leading-5 text-ink-soft">{definition}</dd>
                </div>
              ))}
            </dl>
            <footer className="flex h-8 items-center border-t border-rule px-4 font-mono text-[10px] text-ink-soft">
              esc close
            </footer>
          </aside>
        </div>
      )}
    </>
  );
}
