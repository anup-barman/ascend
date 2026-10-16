import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  api,
  type SyncEvent,
  type SyncReadyFrame,
  type SyncRunnerState,
  type SyncSummary,
} from './api';
import { buildSyncView, type SyncHandles, type SyncView } from './sync';

/**
 * Live sync status over Server-Sent Events (spec §7).
 *
 * The badge is rendered from the summary each frame carries, never from state
 * accumulated in the browser: the server recomputes the roll-up from
 * `sync_state` on every event, so a dropped frame or a reconnect self-corrects
 * instead of leaving the UI describing a run that ended minutes ago.
 */

export interface SyncStream {
  view: SyncView;
  /** The step in progress, e.g. "Syncing Codeforces…". Null between runs. */
  activity: string | null;
  /** False while the stream is down — what is on screen may be stale. */
  connected: boolean;
  /** A request to start a run is in flight (not the run itself). */
  starting: boolean;
  /** Why the trigger failed. Never set for 409, which is not a failure. */
  error: string | null;
  start: () => void;
}

/**
 * @param state `sync` seeds the first render, before the stream's `ready` frame
 *   arrives; `handles` stays live, because editing a handle in Settings changes
 *   which providers are expected to sync at all.
 */
export function useSyncStream(
  state: { sync: SyncSummary; handles: SyncHandles },
  onFinished?: () => void,
): SyncStream {
  const [summary, setSummary] = useState<SyncSummary>(state.sync);
  const [run, setRun] = useState<SyncRunnerState | null>(null);
  const [activity, setActivity] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Held in a ref so an inline callback does not tear the stream down and
  // reconnect on every render of the shell.
  const finished = useRef(onFinished);
  finished.current = onFinished;

  useEffect(() => {
    const source = new EventSource('/api/sync/events');
    let closed = false;

    function parse<T>(event: Event): T | null {
      try {
        return JSON.parse((event as MessageEvent<string>).data) as T;
      } catch {
        return null;
      }
    }

    source.addEventListener('open', () => setConnected(true));
    // EventSource retries on its own; this only records that the last frame may
    // now be stale, so the UI can say so rather than look authoritative.
    source.addEventListener('error', () => setConnected(false));

    source.addEventListener('ready', (event) => {
      const frame = parse<SyncReadyFrame>(event);
      if (!frame) return;
      setConnected(true);
      setSummary(frame.summary);
      setRun(frame.run);
      setActivity(frame.run.running ? 'Sync in progress…' : null);
    });

    source.addEventListener('sync', (event) => {
      const frame = parse<SyncEvent>(event);
      if (!frame) return;

      setSummary(frame.summary);
      if (frame.kind === 'finished') setActivity(null);
      else if (frame.message) setActivity(frame.message);
      else if (frame.kind === 'started') setActivity('Starting sync…');

      if (frame.kind !== 'finished') return;

      // `finished` is emitted from inside the run, before the runner has stored
      // its result, so the per-provider outcomes are read back rather than taken
      // from this frame.
      void api
        .getSyncStatus()
        .then((status) => {
          if (closed) return;
          setSummary({ overall: status.overall, providers: status.providers });
          setRun(status.run);
        })
        .catch(() => {
          /* The stored summary already has the status; only the detail is lost. */
        });

      finished.current?.();
    });

    return () => {
      closed = true;
      source.close();
    };
  }, []);

  const start = useCallback(() => {
    setStarting(true);
    setError(null);
    void api
      .triggerSync()
      .then((result) => {
        if (result.run) setRun(result.run);
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => setStarting(false));
  }, []);

  const view = useMemo(
    () => buildSyncView({ summary, run, handles: state.handles }),
    [summary, run, state.handles],
  );

  return { view, activity, connected, starting, error, start };
}
