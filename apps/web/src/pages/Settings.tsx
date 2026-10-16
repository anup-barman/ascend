import { useState } from 'react';

import { PROVIDER_LABELS } from '@ascend/core';

import { ApiError, api, type AppState, type SecretStatus } from '../api';
import { formatMinutes, relativeTime, weekdayName } from '../format';
import { Button, Chip, Field, Panel, StatusDot } from '../components/ui';

/** Settings (spec §64). */

function useSaver(refresh: () => Promise<void>) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  async function run(key: string, action: () => Promise<unknown>): Promise<void> {
    setBusy(key);
    setError(null);
    setSaved(null);
    try {
      await action();
      await refresh();
      setSaved(key);
      setTimeout(() => setSaved((current) => (current === key ? null : current)), 2500);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Save failed');
      if (caught instanceof ApiError && caught.issues.length > 0) {
        setError(caught.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; '));
      }
    } finally {
      setBusy(null);
    }
  }

  return { run, busy, error, saved };
}

function SaveRow({
  onSave,
  busy,
  saved,
  label = 'Save',
}: {
  onSave: () => void;
  busy: boolean;
  saved: boolean;
  label?: string;
}) {
  return (
    <div className="mt-4 flex items-center gap-3 border-t border-hairline pt-3">
      <Button onClick={onSave} disabled={busy}>
        {busy ? 'Saving…' : label}
      </Button>
      {saved && <span className="text-xs text-good">Saved</span>}
    </div>
  );
}

// ---------------------------------------------------------------------------

function HandlesSection({ state, save }: { state: AppState; save: ReturnType<typeof useSaver> }) {
  const [codeforces, setCodeforces] = useState(state.handles.codeforces ?? '');
  const [atcoder, setAtcoder] = useState(state.handles.atcoder ?? '');

  return (
    <Panel title="Platform handles">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Codeforces" hint="Also used for Codeforces Gym.">
          <input
            className="field"
            value={codeforces}
            onChange={(event) => setCodeforces(event.target.value)}
            spellCheck={false}
          />
        </Field>
        <Field label="AtCoder">
          <input
            className="field"
            value={atcoder}
            onChange={(event) => setAtcoder(event.target.value)}
            spellCheck={false}
          />
        </Field>
      </div>
      <SaveRow
        busy={save.busy === 'handles'}
        saved={save.saved === 'handles'}
        onSave={() =>
          void save.run('handles', () =>
            api.setHandles({
              codeforces: codeforces.trim() || null,
              atcoder: atcoder.trim() || null,
            }),
          )
        }
      />
    </Panel>
  );
}

function RegionalSection({ state, save }: { state: AppState; save: ReturnType<typeof useSaver> }) {
  const [name, setName] = useState(state.targetEvent?.name ?? '');
  const [date, setDate] = useState(state.targetEvent?.date ?? '');
  const [location, setLocation] = useState(state.targetEvent?.location ?? '');

  return (
    <Panel title="Target Regional">
      <Field label="Contest name">
        <input className="field" value={name} onChange={(event) => setName(event.target.value)} />
      </Field>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Field label="Date">
          <input
            type="date"
            className="field"
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
        </Field>
        <Field label="Location">
          <input
            className="field"
            value={location}
            onChange={(event) => setLocation(event.target.value)}
          />
        </Field>
      </div>

      <div className="mt-4 flex items-center gap-3 border-t border-hairline pt-3">
        <Button
          disabled={save.busy === 'regional' || !name.trim() || !date}
          onClick={() =>
            void save.run('regional', () =>
              api.setTargetEvent({ name, date, location: location.trim() || null }),
            )
          }
        >
          {save.busy === 'regional' ? 'Saving…' : 'Save Regional'}
        </Button>
        {save.saved === 'regional' && <span className="text-xs text-good">Saved</span>}
        {state.targetEvent && (
          <Button
            variant="danger"
            className="ml-auto"
            onClick={() => void save.run('regional-clear', () => api.clearTargetEvent())}
          >
            Clear target
          </Button>
        )}
      </div>
    </Panel>
  );
}

function TrainingSection({ state, save }: { state: AppState; save: ReturnType<typeof useSaver> }) {
  const [minutes, setMinutes] = useState<number[]>(state.availability);
  const [simsPerWeek, setSimsPerWeek] = useState(state.settings.training.simulationsPerWeek);

  return (
    <Panel title="Training availability">
      <div className="grid grid-cols-7 gap-2">
        {minutes.map((value, weekday) => (
          <label key={weekday} className="block">
            <span className="mb-1 block text-center text-[0.625rem] tracking-wider text-ink-4 uppercase">
              {weekdayName(weekday)}
            </span>
            <input
              type="number"
              min="0"
              max="1440"
              step="15"
              className="field tnum text-center"
              value={value}
              onChange={(event) => {
                const next = [...minutes];
                next[weekday] = Number.parseInt(event.target.value, 10) || 0;
                setMinutes(next);
              }}
            />
          </label>
        ))}
      </div>
      <p className="mt-2 text-xs text-ink-4">
        Minutes per day. Weekly budget: {formatMinutes(minutes.reduce((sum, m) => sum + m, 0))}
      </p>

      <div className="mt-4 max-w-xs">
        <Field label="Simulations per week" hint="How often a contest simulation is scheduled.">
          <input
            type="number"
            min="0"
            max="7"
            className="field tnum"
            value={simsPerWeek}
            onChange={(event) => setSimsPerWeek(Number.parseInt(event.target.value, 10) || 0)}
          />
        </Field>
      </div>

      <SaveRow
        busy={save.busy === 'training'}
        saved={save.saved === 'training'}
        onSave={() =>
          void save.run('training', async () => {
            await api.setAvailability(minutes);
            await api.updateSettings({ training: { simulationsPerWeek: simsPerWeek } });
          })
        }
      />
    </Panel>
  );
}

function SyncSection({ state, save }: { state: AppState; save: ReturnType<typeof useSaver> }) {
  const [autoSync, setAutoSync] = useState(state.settings.sync.autoSyncOnLaunch);
  const [interval, setInterval] = useState(state.settings.sync.intervalMinutes);
  const [fetchSources, setFetchSources] = useState(state.settings.sync.fetchSubmissionSources);

  return (
    <Panel title="Synchronization">
      <div className="space-y-3">
        <label className="flex items-center gap-2 text-sm text-ink-2">
          <input
            type="checkbox"
            checked={autoSync}
            onChange={(event) => setAutoSync(event.target.checked)}
          />
          Sync automatically when Ascend starts
        </label>
        <label className="flex items-center gap-2 text-sm text-ink-2">
          <input
            type="checkbox"
            checked={fetchSources}
            onChange={(event) => setFetchSources(event.target.checked)}
          />
          Fetch submission source code for review
          <span className="text-xs text-ink-4">(requires a Codeforces session)</span>
        </label>
        <div className="max-w-xs">
          <Field label="Background sync interval (minutes)">
            <input
              type="number"
              min="5"
              max="1440"
              className="field tnum"
              value={interval}
              onChange={(event) => setInterval(Number.parseInt(event.target.value, 10) || 60)}
            />
          </Field>
        </div>
      </div>

      <div className="mt-4 space-y-1.5 border-t border-hairline pt-3">
        {state.sync.providers.map((provider) => (
          <div key={provider.provider} className="flex items-center justify-between gap-3 text-sm">
            <span className="flex items-center gap-2 text-ink-3">
              <StatusDot
                severity={
                  provider.status === 'up_to_date'
                    ? 'good'
                    : provider.status === 'failed'
                      ? 'critical'
                      : provider.status === 'partially_synced'
                        ? 'warning'
                        : 'unknown'
                }
              />
              {PROVIDER_LABELS[provider.provider]}
            </span>
            <span className="text-ink-4">{relativeTime(provider.lastSuccessAt)}</span>
          </div>
        ))}
      </div>

      <SaveRow
        busy={save.busy === 'sync'}
        saved={save.saved === 'sync'}
        onSave={() =>
          void save.run('sync', () =>
            api.updateSettings({
              sync: {
                autoSyncOnLaunch: autoSync,
                intervalMinutes: interval,
                fetchSubmissionSources: fetchSources,
              },
            }),
          )
        }
      />
    </Panel>
  );
}

function AiSection({ state, save }: { state: AppState; save: ReturnType<typeof useSaver> }) {
  const { ai } = state.settings;
  const [enabled, setEnabled] = useState(ai.enabled);
  const [provider, setProvider] = useState(ai.provider);
  const [model, setModel] = useState(ai.model);
  const [deepModel, setDeepModel] = useState(ai.deepModel);

  return (
    <Panel title="AI coaching">
      <p className="mb-4 max-w-prose text-xs leading-relaxed text-ink-4">
        The AI layer writes coaching language, reviews code and classifies problems into
        subtopics. All analysis, tracking and planning works without it — Ascend never depends
        on a model being available.
      </p>

      <label className="flex items-center gap-2 text-sm text-ink-2">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => setEnabled(event.target.checked)}
        />
        Enable AI features
      </label>

      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <Field label="Provider">
          <select
            className="field"
            value={provider}
            onChange={(event) => setProvider(event.target.value as typeof provider)}
          >
            <option value="anthropic">Anthropic (Claude)</option>
            <option value="openai">OpenAI</option>
            <option value="ollama">Ollama (local)</option>
          </select>
        </Field>
        <Field label="Model" hint="Routine coaching and classification.">
          <input className="field" value={model} onChange={(event) => setModel(event.target.value)} />
        </Field>
        <Field label="Deep model" hint="Contest analysis and code review.">
          <input
            className="field"
            value={deepModel}
            onChange={(event) => setDeepModel(event.target.value)}
          />
        </Field>
      </div>

      <SaveRow
        busy={save.busy === 'ai'}
        saved={save.saved === 'ai'}
        onSave={() =>
          void save.run('ai', () =>
            api.updateSettings({ ai: { enabled, provider, model, deepModel } }),
          )
        }
      />
    </Panel>
  );
}

const SECRET_LABELS: Record<SecretStatus['name'], string> = {
  codeforces_session: 'Codeforces session cookie',
  anthropic_api_key: 'Anthropic API key',
  openai_api_key: 'OpenAI API key',
};

function SecretsSection({ state, save }: { state: AppState; save: ReturnType<typeof useSaver> }) {
  const [values, setValues] = useState<Record<string, string>>({});

  return (
    <Panel title="Credentials">
      {state.secretsError && (
        <div className="mb-4 rounded-md border border-critical/40 bg-critical/10 px-3 py-2 text-sm text-ink-2">
          {state.secretsError}
        </div>
      )}

      <p className="mb-4 max-w-prose text-xs leading-relaxed text-ink-4">
        Stored encrypted (AES-256-GCM) in <code>~/.ascend/secrets.json</code> with file mode 600,
        and never sent anywhere except the service they belong to. They are write-only here: once
        saved, no screen and no API response can read them back.
        {state.secretsKeySource === 'keyfile' && (
          <>
            {' '}
            The encryption key currently sits beside the data in <code>~/.ascend/secret.key</code>,
            so this protects against casual disclosure and backups, not against another program
            running as you. Set <code>ASCEND_PASSPHRASE</code> before starting Ascend to derive the
            key from a passphrase instead.
          </>
        )}
      </p>

      <div className="space-y-4">
        {state.secrets.map((secret) => (
          <div key={secret.name}>
            <div className="mb-1.5 flex items-center justify-between gap-3">
              <span className="text-xs font-medium text-ink-2">{SECRET_LABELS[secret.name]}</span>
              {secret.present ? (
                <Chip severity="good">stored {relativeTime(secret.updatedAt)}</Chip>
              ) : (
                <Chip>not set</Chip>
              )}
            </div>

            {secret.name === 'codeforces_session' && (
              <p className="mb-1.5 max-w-prose text-xs leading-relaxed text-ink-4">
                Needed for Gym submissions, Gym standings and submission source code — none of
                which the public Codeforces API exposes. Copy the <code>JSESSIONID</code> cookie
                for codeforces.com from your browser's developer tools.{' '}
                <span className="text-serious">
                  This cookie grants full access to your Codeforces account while it is valid, and
                  it will expire periodically.
                </span>
              </p>
            )}

            <div className="flex gap-2">
              <input
                className="field"
                type="password"
                placeholder={secret.present ? 'Replace stored value…' : 'Paste value…'}
                value={values[secret.name] ?? ''}
                onChange={(event) =>
                  setValues((current) => ({ ...current, [secret.name]: event.target.value }))
                }
                autoComplete="off"
                spellCheck={false}
              />
              <Button
                disabled={!values[secret.name] || save.busy === secret.name}
                onClick={() =>
                  void save.run(secret.name, async () => {
                    await api.setSecret(secret.name, values[secret.name] ?? '');
                    setValues((current) => ({ ...current, [secret.name]: '' }));
                  })
                }
              >
                {save.busy === secret.name ? 'Saving…' : 'Store'}
              </Button>
              {secret.present && (
                <Button
                  variant="danger"
                  onClick={() => void save.run(secret.name, () => api.deleteSecret(secret.name))}
                >
                  Forget
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

export function Settings({
  state,
  refresh,
}: {
  state: AppState;
  refresh: () => Promise<void>;
}) {
  const save = useSaver(refresh);

  return (
    <div className="max-w-3xl space-y-6">
      {save.error && (
        <div className="rounded-md border border-critical/40 bg-critical/10 px-3 py-2 text-sm text-ink-2">
          {save.error}
        </div>
      )}

      <HandlesSection state={state} save={save} />
      <RegionalSection state={state} save={save} />
      <TrainingSection state={state} save={save} />
      <SyncSection state={state} save={save} />
      <AiSection state={state} save={save} />
      <SecretsSection state={state} save={save} />
    </div>
  );
}
