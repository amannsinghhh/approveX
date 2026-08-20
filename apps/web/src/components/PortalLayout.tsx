/**
 * Portal shell — the self-service surface (P0.1). A requester lands here to file
 * a request and track their own; they are *not* dropped into the admin console
 * sidebar. So this is a deliberately light top-bar chrome: wordmark, the two
 * things a requester does (New request / My requests), and sign out.
 */
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { cn } from '../lib/cn';
import { useAuth } from '../lib/auth';
import { Button } from './ui';
import { Wordmark } from './AppShell';

const PORTAL_NAV = [
  { to: '/submit', label: 'New request' },
  { to: '/my-requests', label: 'My requests' },
];

function PortalNavLink({ to, label }: { to: string; label: string }): React.JSX.Element {
  return (
    <NavLink
      to={to}
      // /submit stays lit while on /submit/:context; end only on the ledger tab.
      end={to === '/my-requests'}
      className={({ isActive }) =>
        cn(
          'flex h-8 items-center rounded-[6px] px-2.5 text-sm font-medium transition-colors duration-150',
          isActive ? 'bg-brand-bg text-brand' : 'text-ink-soft hover:text-ink',
        )
      }
    >
      {label}
    </NavLink>
  );
}

export function PortalLayout(): React.JSX.Element {
  const { me, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <div className="app-bg flex min-h-screen flex-col">
      <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-4 border-b border-rule bg-surface/80 px-4 backdrop-blur-md elev-sm">
        <div className="flex items-baseline gap-2">
          <Wordmark />
          <span className="text-xs font-medium uppercase tracking-[0.08em] text-ink-soft">
            Portal
          </span>
        </div>
        <nav className="flex items-center gap-1">
          {PORTAL_NAV.map((item) => (
            <PortalNavLink key={item.to} {...item} />
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <div className="text-right">
            <p className="truncate text-sm font-medium leading-tight text-ink">{me?.name}</p>
            <p className="truncate text-xs leading-tight text-ink-soft">{me?.tenant?.name}</p>
          </div>
          <Button
            variant="ghost"
            className="text-sm"
            onClick={() => {
              logout();
              navigate('/login');
            }}
          >
            Sign out
          </Button>
        </div>
      </header>
      {/* Centered reading column — the portal is a form, not a full-bleed console. */}
      <main className="relative z-10 mx-auto w-full max-w-3xl flex-1 px-4 py-6">
        <div key={location.pathname} className="animate-fade">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
