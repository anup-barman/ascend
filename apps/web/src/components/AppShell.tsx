import type { ReactNode } from 'react';
import { Link, NavLink } from 'react-router-dom';

import type { AppState } from '../api';
import { relativeTime } from '../format';
import type { SyncView } from '../sync';
import type { SyncStream } from '../useSyncStream';
import { StatusDot, urgencySeverity } from './ui';

/**
 * The application shell: navigation (spec §42) and a persistent header carrying
 * the countdown, which §3 requires to be visible throughout the application, and
 * the sync badge §7 requires to show which of its four states the data is in.
 */

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard' },
  { to: '/train', label: 'Train' },
  { to: '/contests', label: 'Contests' },
  { to: '/analytics', label: 'Analytics' },
  { to: '/syllabus', label: 'Syllabus' },
  { to: '/mistakes', label: 'Mistakes' },
  { to: '/history', label: 'History' },
  { to: '/coach', label: 'Coach' },
  { to: '/settings', label: 'Settings' },
] as const;

/**
 * Per-provider freshness (§2 "Last synchronized: Codeforces: 2 hours ago").
 *
 * Warnings and failure reasons are repeated here rather than left to the
 * dashboard panel: the badge is visible on every screen, so the reason behind it
 * has to be reachable from every screen too (§7).
 */
function SyncPopover({ view }: { view: SyncView }) {
  return (
    <div className="absolute top-full right-0 z-20 mt-2 hidden w-80 panel p-3 group-hover:block">
      <div className="eyebrow mb-2">Last synchronized</div>
      <ul className="space-y-2">
        {view.providers.map((provider) => (
          <li key={provider.provider} className="text-sm">
            <div className="flex items-baseline justify-between gap-3">
              <span className="flex items-center gap-2 text-ink-3">
                <StatusDot severity={provider.severity} />
                {provider.label}
              </span>
              <span className="tnum text-ink-2">
                {provider.configured ? relativeTime(provider.lastSuccessAt) : 'no handle'}
              </span>
            </div>
            {provider.messages.map((message) => (
              <div key={message} className="mt-0.5 pl-4 text-xs leading-relaxed text-ink-4">
                {message}
              </div>
            ))}
          </li>
        ))}
      </ul>

      {view.needsHandles ? (
        <p className="mt-2 border-t border-hairline pt-2 text-xs leading-relaxed text-ink-4">
          No platform handles are configured.{' '}
          <Link to="/settings" className="text-accent underline underline-offset-2">
            Add one in Settings
          </Link>
        </p>
      ) : (
        <p className="mt-2 border-t border-hairline pt-2 text-xs leading-relaxed text-ink-4">
          Click the badge to synchronize now.
        </p>
      )}
    </div>
  );
}

export function AppShell({
  state,
  sync,
  children,
}: {
  state: AppState;
  sync: SyncStream;
  children: ReactNode;
}) {
  const { countdown, targetEvent } = state;
  const { view } = sync;

  return (
    <div className="flex h-full">
      {/* Navigation rail */}
      <nav className="flex w-52 shrink-0 flex-col border-r border-hairline bg-panel">
        <div className="border-b border-hairline px-4 py-4">
          <div className="text-sm font-semibold tracking-[0.2em] text-ink">ASCEND</div>
          <div className="mt-0.5 text-[0.625rem] leading-tight tracking-wider text-ink-4 uppercase">
            ICPC Regional
            <br />
            Preparation System
          </div>
        </div>

        <ul className="flex-1 space-y-0.5 p-2">
          {NAV_ITEMS.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) =>
                  `block rounded px-3 py-1.5 text-sm tracking-wide transition-colors ${
                    isActive
                      ? 'bg-raised font-medium text-ink'
                      : 'text-ink-3 hover:bg-raised/60 hover:text-ink-2'
                  }`
                }
              >
                {item.label}
              </NavLink>
            </li>
          ))}
        </ul>

        <div className="border-t border-hairline px-4 py-3 text-[0.625rem] leading-relaxed text-ink-4">
          Train with purpose.
          <br />
          Compete with confidence.
        </div>
      </nav>

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 items-center justify-between gap-4 border-b border-hairline bg-panel px-6 py-3">
          <div className="min-w-0">
            {targetEvent ? (
              <>
                <div className="truncate text-sm font-medium text-ink">{targetEvent.name}</div>
                <div className="text-xs text-ink-4">
                  {targetEvent.location ? `${targetEvent.location} · ` : ''}
                  {targetEvent.date}
                </div>
              </>
            ) : (
              <div className="text-sm text-ink-3">No target contest configured</div>
            )}
          </div>

          <div className="flex items-center gap-5">
            {/* Countdown, compact — the hero version lives on the dashboard. */}
            <div className="text-right">
              {countdown.daysRemaining === null ? (
                <div className="text-sm text-ink-4">—</div>
              ) : (
                <>
                  <div className="flex items-baseline justify-end gap-1.5">
                    <span className="text-xl leading-none font-semibold text-ink">
                      {countdown.daysRemaining}
                    </span>
                    <span className="text-[0.625rem] tracking-wider text-ink-3 uppercase">
                      {Math.abs(countdown.daysRemaining) === 1 ? 'day' : 'days'}
                    </span>
                  </div>
                  <div className="mt-0.5 flex items-center justify-end gap-1.5 text-[0.625rem] tracking-wider text-ink-4 uppercase">
                    <StatusDot severity={urgencySeverity(countdown.urgency)} />
                    {countdown.daysRemaining < 0 ? 'elapsed' : 'to regional'}
                  </div>
                </>
              )}
            </div>

            {/* Sync badge — status, hover detail, and the trigger itself (§7). */}
            <div className="flex items-center gap-3">
              {sync.activity && (
                <span className="hidden max-w-56 truncate text-xs text-ink-4 lg:block">
                  {sync.activity}
                </span>
              )}
              <div className="group relative">
                <button
                  type="button"
                  onClick={sync.start}
                  disabled={view.running || sync.starting || view.needsHandles}
                  title={
                    view.needsHandles
                      ? 'Configure a platform handle in Settings first'
                      : 'Synchronize now'
                  }
                  className="flex items-center gap-2 rounded border border-hairline-strong bg-raised px-2.5 py-1.5 text-[0.6875rem] font-semibold tracking-wider text-ink-2 uppercase transition-colors enabled:hover:border-ink-4 disabled:cursor-default"
                >
                  <StatusDot severity={view.severity} />
                  {view.statusLabel}
                </button>
                <SyncPopover view={view} />
              </div>
            </div>
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
