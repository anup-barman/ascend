import { Link } from 'react-router-dom';

import type { ProviderSyncView } from '../sync';
import type { SyncStream } from '../useSyncStream';
import { relativeTime } from '../format';
import { Button, Panel, StatusDot } from './ui';

/**
 * Synchronization status in full (spec §7, §2).
 *
 * The header badge says *which* of the four states the data is in; this says
 * *why*. A PARTIALLY SYNCED or SYNC FAILED badge with no readable reason is the
 * silent-missing-data failure §7 exists to prevent, so every warning and every
 * error is rendered as text here — and a provider with no handle is offered a
 * link to Settings rather than reported as broken.
 */

function ProviderRow({ provider }: { provider: ProviderSyncView }) {
  return (
    <li className="py-2.5 first:pt-0 last:pb-0">
      <div className="flex items-baseline justify-between gap-4">
        <span className="flex items-center gap-2 text-sm text-ink-2">
          <StatusDot severity={provider.severity} />
          {provider.label}
        </span>
        <span className="flex items-baseline gap-3">
          <span className="text-[0.6875rem] tracking-wider text-ink-4 uppercase">
            {provider.statusLabel}
          </span>
          <span className="tnum text-xs text-ink-3">
            {provider.configured ? relativeTime(provider.lastSuccessAt) : '—'}
          </span>
        </span>
      </div>

      {!provider.configured && (
        <div className="mt-1 text-xs leading-relaxed text-ink-4">
          No handle configured, so this source is not synchronized.{' '}
          <Link to="/settings" className="text-accent underline underline-offset-2">
            Add one in Settings
          </Link>
        </div>
      )}

      {provider.messages.map((message) => (
        <div key={message} className="mt-1 flex gap-2 text-xs leading-relaxed text-ink-4">
          <span aria-hidden>·</span>
          <span>{message}</span>
        </div>
      ))}

      {provider.itemsSynced !== null && provider.itemsSynced > 0 && (
        <div className="tnum mt-1 text-xs text-ink-4">
          {provider.itemsSynced} submission{provider.itemsSynced === 1 ? '' : 's'} stored on the
          last attempt
        </div>
      )}
    </li>
  );
}

export function SyncPanel({ sync }: { sync: SyncStream }) {
  const { view } = sync;

  return (
    <Panel
      title="Data synchronization"
      actions={
        <div className="flex items-center gap-3">
          {sync.activity && <span className="text-xs text-ink-4">{sync.activity}</span>}
          <Button
            onClick={sync.start}
            disabled={view.running || sync.starting || view.needsHandles}
          >
            {view.running ? 'Syncing…' : 'Sync now'}
          </Button>
        </div>
      }
    >
      <ul className="divide-y divide-hairline">
        {view.providers.map((provider) => (
          <ProviderRow key={provider.provider} provider={provider} />
        ))}
      </ul>

      {sync.error && (
        <p className="mt-3 border-t border-hairline pt-3 text-xs leading-relaxed text-critical">
          Could not start a sync: {sync.error}
        </p>
      )}

      {view.engineError && (
        <p className="mt-3 border-t border-hairline pt-3 text-xs leading-relaxed text-critical">
          The last run stopped before it finished: {view.engineError}
        </p>
      )}

      {!sync.connected && (
        <p className="mt-3 border-t border-hairline pt-3 text-xs leading-relaxed text-ink-4">
          Not receiving live updates from the server. What you see here is the last status it
          reported, and may be out of date.
        </p>
      )}

      <p className="mt-3 border-t border-hairline pt-3 text-xs leading-relaxed text-ink-4">
        A provider that fails changes nothing else: no history is deleted and the next attempt
        resumes where this one stopped, rather than refetching everything.
      </p>
    </Panel>
  );
}
