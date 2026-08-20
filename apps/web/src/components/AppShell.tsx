import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  BarChart3,
  FileSpreadsheet,
  FlaskConical,
  Inbox,
  List,
  ListChecks,
  ScrollText,
  Settings,
  Table2,
  Tags,
  Users,
  Workflow,
} from 'lucide-react';
import { cn } from '../lib/cn';
import { useAuth } from '../lib/auth';
import { CommandPalette } from './CommandPalette';
import { GlossaryDrawer } from './GlossaryDrawer';
import { SetupChecklist } from './SetupChecklist';
import { Button } from './ui';

interface NavItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ size?: number | string }>;
  disabled?: string; // phase note
}

const NAV: NavItem[] = [
  { to: '/inbox', label: 'Inbox', icon: Inbox },
  { to: '/requests', label: 'Requests', icon: ListChecks },
  { to: '/rules', label: 'Rules', icon: ScrollText },
  { to: '/decision-tables', label: 'Decision tables', icon: Table2 },
  { to: '/workflows', label: 'Workflows', icon: Workflow },
  { to: '/sandbox', label: 'Sandbox', icon: FlaskConical },
  { to: '/analytics', label: 'Analytics', icon: BarChart3 },
  { to: '/audit', label: 'Audit log', icon: FileSpreadsheet },
];

const ADMIN_NAV: NavItem[] = [
  { to: '/fields', label: 'Fields', icon: Tags },
  { to: '/managed-lists', label: 'Managed lists', icon: List },
  { to: '/people', label: 'People & access', icon: Users },
  // NavLink partial matching keeps this lit for every /settings/* section.
  { to: '/settings', label: 'Settings', icon: Settings },
];

function NavEntry({ item }: { item: NavItem }): React.JSX.Element {
  const Icon = item.icon;
  if (item.disabled) {
    return (
      <span
        title={`Arrives in ${item.disabled}`}
        className="flex h-8 cursor-not-allowed items-center gap-2.5 rounded-[6px] px-2.5 text-base text-ink-soft/50"
      >
        <Icon size={15} /> {item.label}
      </span>
    );
  }
  return (
    <NavLink
      to={item.to}
      className={({ isActive }) =>
        cn(
          'relative flex h-8 items-center gap-2.5 rounded-[6px] px-2.5 text-base transition-all duration-150',
          isActive
            ? 'bg-brand-bg font-medium text-brand shadow-[0_2px_10px_-4px_rgba(29,78,216,0.35)]'
            : 'text-ink-soft hover:translate-x-0.5 hover:text-ink',
        )
      }
    >
      {({ isActive }) => (
        <>
          {/* the active tab plants a small brand-ink bar in the left margin */}
          <span
            className={cn(
              'absolute -left-1 h-4 w-[3px] rounded-full bg-brand transition-all duration-200',
              isActive ? 'scale-y-100 opacity-100' : 'scale-y-0 opacity-0',
            )}
          />
          <Icon size={15} /> {item.label}
        </>
      )}
    </NavLink>
  );
}

export function Wordmark(): React.JSX.Element {
  // Brand identity (UI spec §5.9): the X is a small brand-blue stamp chip.
  return (
    <span className="flex items-baseline gap-[3px] text-lg font-bold tracking-tight text-ink">
      Approve
      <span className="inline-block -rotate-2 rounded-[2px] border-[1.5px] border-brand bg-brand-bg px-[3px] font-mono text-[13px] font-semibold text-brand">
        X
      </span>
    </span>
  );
}

export function AppShell(): React.JSX.Element {
  const { me, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <div className="app-bg flex min-h-screen">
      <aside className="fixed inset-y-0 z-20 flex w-[220px] flex-col border-r border-rule bg-surface/80 px-3 py-4 backdrop-blur-md elev-md">
        <div className="mb-6 px-2">
          <Wordmark />
        </div>
        <nav className="flex flex-col gap-0.5">
          {NAV.map((item) => (
            <NavEntry key={item.to} item={item} />
          ))}
        </nav>
        <div className="mt-4 border-t border-rule pt-3">
          <p className="mb-1 px-2.5 text-xs font-medium uppercase tracking-wide text-ink-soft/70">
            Admin
          </p>
          {ADMIN_NAV.map((item) => (
            <NavEntry key={item.to} item={item} />
          ))}
        </div>
        <div className="mt-auto border-t border-rule pt-3">
          <SetupChecklist />
          <div className="mb-2 flex items-center justify-between px-2.5">
            <p className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-soft/70">
              ⌘K — jump anywhere
            </p>
            <GlossaryDrawer />
          </div>
          <p className="truncate px-2.5 text-sm font-medium text-ink">{me?.name}</p>
          <p className="truncate px-2.5 text-xs text-ink-soft">{me?.tenant?.name}</p>
          <Button
            variant="ghost"
            className="mt-1 h-7 text-sm"
            onClick={() => {
              logout();
              navigate('/login');
            }}
          >
            Sign out
          </Button>
        </div>
      </aside>
      {/* Density scale (§2): 16px page padding, full-bleed — no centered container. */}
      <main className="relative z-10 ml-[220px] min-w-0 flex-1 px-4 py-3">
        {/* keying on pathname replays the fade each navigation — the new page
            settles in rather than snapping */}
        <div key={location.pathname} className="animate-fade">
          <Outlet />
        </div>
      </main>
      <CommandPalette />
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
  children,
}: {
  title: React.ReactNode;
  /** One quiet sentence that says what this page is for — orientation, not lore. */
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  children?: React.ReactNode;
}): React.JSX.Element {
  return (
    <header className="mb-3">
      <div className="flex min-h-[36px] items-center justify-between gap-4">
        <div className="flex min-w-0 items-baseline gap-3">
          <h1 className="animate-ink shrink-0 text-lg font-bold tracking-tight text-ink">
            {title}
          </h1>
          {subtitle && <p className="truncate text-sm text-ink-soft">{subtitle}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      </div>
      {children}
    </header>
  );
}
