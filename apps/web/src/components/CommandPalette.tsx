/**
 * Cmd+K command palette (Phase 7): jump anywhere, start anything, find any
 * request — without leaving the keyboard. Mono, bordered, stamp-flavoured.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { cn } from '../lib/cn';
import { StampChip } from './StampChip';

interface Command {
  id: string;
  label: string;
  hint: string;
  to: string;
  keywords?: string;
  stamp?: string;
}

const STATIC_COMMANDS: Command[] = [
  { id: 'nav-inbox', label: 'Inbox', hint: 'go to', to: '/inbox', keywords: 'approvals pending' },
  {
    id: 'nav-requests',
    label: 'Requests',
    hint: 'go to',
    to: '/requests',
    keywords: 'ledger explorer',
  },
  { id: 'nav-rules', label: 'Rules', hint: 'go to', to: '/rules' },
  {
    id: 'nav-tables',
    label: 'Decision tables',
    hint: 'go to',
    to: '/decision-tables',
    keywords: 'grid matrix',
  },
  {
    id: 'nav-workflows',
    label: 'Workflows',
    hint: 'go to',
    to: '/workflows',
    keywords: 'canvas graph',
  },
  {
    id: 'nav-sandbox',
    label: 'Sandbox',
    hint: 'go to',
    to: '/sandbox',
    keywords: 'test dry run evaluate',
  },
  {
    id: 'nav-analytics',
    label: 'Analytics',
    hint: 'go to',
    to: '/analytics',
    keywords: 'stats metrics dashboard',
  },
  {
    id: 'nav-audit',
    label: 'Audit log',
    hint: 'go to',
    to: '/audit',
    keywords: 'events history trail',
  },
  {
    id: 'nav-fields',
    label: 'Fields',
    hint: 'go to',
    to: '/fields',
    keywords: 'schema registry types',
  },
  {
    id: 'nav-webhooks',
    label: 'Webhooks',
    hint: 'go to',
    to: '/settings/webhooks',
    keywords: 'endpoints deliveries secret',
  },
  {
    id: 'nav-apikeys',
    label: 'API keys',
    hint: 'go to',
    to: '/settings/api-keys',
    keywords: 'tokens machine credentials',
  },
  {
    id: 'new-rule',
    label: 'New rule',
    hint: 'create',
    to: '/rules/new',
    keywords: 'condition builder',
  },
  { id: 'new-table', label: 'New decision table', hint: 'create', to: '/decision-tables/new' },
  {
    id: 'new-workflow',
    label: 'New workflow',
    hint: 'create',
    to: '/workflows/new',
    keywords: 'approval chain',
  },
  {
    id: 'setup',
    label: 'Guided setup (templates)',
    hint: 'create',
    to: '/welcome',
    keywords: 'onboarding wizard template',
  },
];

interface RequestHit {
  id: string;
  title: string | null;
  context: string | null;
  status: string;
}

export function CommandPalette(): React.JSX.Element | null {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const [requests, setRequests] = useState<RequestHit[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((prev) => !prev);
        setQuery('');
        setSelected(0);
      } else if (event.key === 'Escape') {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // recent requests, fetched once per open
  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    api<{ items: RequestHit[] }>('/requests?page=1&pageSize=8')
      .then((res) => setRequests(res.items))
      .catch(() => setRequests([]));
  }, [open]);

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matches = (haystack: string): boolean =>
      needle.split(/\s+/).every((word) => haystack.includes(word));

    const commands = STATIC_COMMANDS.filter((command) =>
      matches(`${command.label} ${command.hint} ${command.keywords ?? ''}`.toLowerCase()),
    );
    const requestHits: Command[] = requests
      .filter((request) =>
        matches(`${request.title ?? ''} ${request.context ?? ''} ${request.id}`.toLowerCase()),
      )
      .map((request) => ({
        id: `req-${request.id}`,
        label: request.title ?? request.context ?? request.id.slice(0, 8),
        hint: 'request',
        to: `/requests?request=${request.id}`,
        stamp: request.status,
      }));
    return [...commands, ...requestHits].slice(0, 10);
  }, [query, requests]);

  const run = useCallback(
    (command: Command | undefined): void => {
      if (!command) return;
      setOpen(false);
      navigate(command.to);
    },
    [navigate],
  );

  if (!open) return null;

  return (
    <div
      className="animate-fade fixed inset-0 z-50 flex items-start justify-center bg-ink/20 pt-[18vh] backdrop-blur-[1px]"
      onClick={() => setOpen(false)}
    >
      <div
        className="animate-pop w-[560px] overflow-hidden rounded-[10px] border border-rule bg-surface shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelected(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' || (e.key === 'j' && e.ctrlKey)) {
              e.preventDefault();
              setSelected((prev) => Math.min(prev + 1, results.length - 1));
            } else if (e.key === 'ArrowUp' || (e.key === 'k' && e.ctrlKey)) {
              e.preventDefault();
              setSelected((prev) => Math.max(prev - 1, 0));
            } else if (e.key === 'Enter') {
              run(results[selected]);
            }
          }}
          placeholder="Jump to, create, or find a request…"
          aria-label="Command palette"
          className="h-12 w-full border-b border-rule bg-surface px-4 font-mono text-sm text-ink outline-none placeholder:text-ink-soft/60"
        />
        <div className="max-h-[320px] overflow-y-auto py-1">
          {results.length === 0 && (
            <p className="px-4 py-6 text-center text-sm text-ink-soft">Nothing matches.</p>
          )}
          {results.map((command, index) => (
            <button
              key={command.id}
              type="button"
              onMouseEnter={() => setSelected(index)}
              onClick={() => run(command)}
              className={cn(
                'flex h-10 w-full items-center gap-3 px-4 text-left',
                index === selected ? 'bg-brand-bg' : 'hover:bg-paper',
              )}
            >
              <span className="w-14 shrink-0 font-mono text-[10px] uppercase tracking-[0.08em] text-ink-soft">
                {command.hint}
              </span>
              <span className="min-w-0 flex-1 truncate text-base text-ink">{command.label}</span>
              {command.stamp && <StampChip label={command.stamp} />}
              {index === selected && <span className="font-mono text-[10px] text-ink-soft">↵</span>}
            </button>
          ))}
        </div>
        <div className="flex h-8 items-center gap-3 border-t border-rule px-4 font-mono text-[10px] text-ink-soft">
          <span>↑↓ move</span>
          <span>↵ open</span>
          <span>esc close</span>
        </div>
      </div>
    </div>
  );
}
