/**
 * Settings shell (restructure §3.6): two-pane — a 200px section nav on the
 * left, setting rows constrained to max-w-3xl on the right. Sections render
 * through the outlet; the sidebar carries one "Settings" entry, not one per
 * section.
 */
import { NavLink, Outlet } from 'react-router-dom';
import { KeyRound, Webhook } from 'lucide-react';
import { cn } from '../lib/cn';
import { PageHeader } from './AppShell';

const SECTIONS = [
  { to: '/settings/webhooks', label: 'Webhooks', icon: Webhook },
  { to: '/settings/api-keys', label: 'API keys', icon: KeyRound },
] as const;

export function SettingsLayout(): React.JSX.Element {
  return (
    <>
      <PageHeader title="Settings" subtitle="Tenant-wide integration and credential config." />

      <div className="flex items-start gap-6">
        <nav aria-label="Settings sections" className="flex w-[200px] shrink-0 flex-col gap-0.5">
          {SECTIONS.map((section) => {
            const Icon = section.icon;
            return (
              <NavLink
                key={section.to}
                to={section.to}
                className={({ isActive }) =>
                  cn(
                    'flex h-8 items-center gap-2.5 rounded-[6px] px-2.5 text-base transition-colors duration-150',
                    isActive
                      ? 'bg-brand-bg font-medium text-brand'
                      : 'text-ink-soft hover:text-ink',
                  )
                }
              >
                <Icon size={15} /> {section.label}
              </NavLink>
            );
          })}
        </nav>

        <div className="min-w-0 max-w-3xl flex-1">
          <Outlet />
        </div>
      </div>
    </>
  );
}
