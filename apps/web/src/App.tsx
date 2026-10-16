import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Route, Routes } from 'react-router-dom';

import { api, type AppState } from './api';
import { AppShell } from './components/AppShell';
import { Dashboard } from './pages/Dashboard';
import { Onboarding } from './pages/Onboarding';
import {
  Analytics,
  Coach,
  Contests,
  History,
  Mistakes,
  Syllabus,
  Train,
} from './pages/Placeholders';
import { Settings } from './pages/Settings';
import { useSyncStream } from './useSyncStream';

const STATE_KEY = ['app-state'] as const;

/**
 * The application proper, mounted only once there is state to render it from.
 *
 * It is a separate component because the sync stream is a hook and `App` returns
 * early while loading and during onboarding — and because a finished run is the
 * one event that invalidates everything else on screen, so the refresh belongs
 * next to the stream that hears about it.
 */
function Workspace({ state, refresh }: { state: AppState; refresh: () => Promise<void> }) {
  const sync = useSyncStream(state, () => void refresh());

  return (
    <AppShell state={state} sync={sync}>
      <Routes>
        <Route path="/" element={<Dashboard state={state} sync={sync} />} />
        <Route path="/train" element={<Train />} />
        <Route path="/contests" element={<Contests />} />
        <Route path="/analytics" element={<Analytics />} />
        <Route path="/syllabus" element={<Syllabus />} />
        <Route path="/mistakes" element={<Mistakes />} />
        <Route path="/history" element={<History />} />
        <Route path="/coach" element={<Coach />} />
        <Route path="/settings" element={<Settings state={state} refresh={refresh} />} />
      </Routes>
    </AppShell>
  );
}

export function App() {
  const queryClient = useQueryClient();
  const { data: state, isPending, error, refetch } = useQuery({
    queryKey: STATE_KEY,
    queryFn: api.getState,
  });

  const refresh = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: STATE_KEY });
  };

  if (isPending) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-sm tracking-widest text-ink-4 uppercase">Loading Ascend…</div>
      </div>
    );
  }

  if (error || !state) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="panel max-w-md p-6">
          <div className="text-sm font-medium text-ink">Cannot reach the Ascend server</div>
          <p className="mt-2 text-sm leading-relaxed text-ink-3">
            {error instanceof Error ? error.message : 'Unknown error'}
          </p>
          <p className="mt-2 text-xs leading-relaxed text-ink-4">
            Start it with <code>pnpm dev</code> from the project root.
          </p>
          <button
            type="button"
            onClick={() => void refetch()}
            className="mt-4 rounded-md border border-hairline-strong bg-raised px-3 py-1.5 text-sm text-ink"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  // Onboarding owns the whole window until it is finished (spec §8).
  if (!state.onboarded) {
    return (
      <Onboarding
        onComplete={(next: AppState) => {
          queryClient.setQueryData(STATE_KEY, next);
        }}
      />
    );
  }

  return <Workspace state={state} refresh={refresh} />;
}
