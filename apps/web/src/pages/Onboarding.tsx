import { useState } from 'react';

import { computeCountdown, countdownHeadline } from '@ascend/core';

import { ApiError, api, type AppState } from '../api';
import { formatMinutes, weekdayName } from '../format';
import { Button, Field, Panel } from '../components/ui';

/**
 * Onboarding (spec §8), in the six steps the spec lays out.
 *
 * The target Regional is skippable: §3 forbids inventing a contest date, and a
 * user who has not had theirs announced yet should still be able to finish setup.
 */

const STEPS = [
  'Welcome',
  'Codeforces',
  'AtCoder',
  'Regional',
  'Training',
  'Review',
] as const;

interface Draft {
  codeforces: string;
  atcoder: string;
  eventName: string;
  eventDate: string;
  eventLocation: string;
  skipEvent: boolean;
  displayName: string;
  teamName: string;
  weekdayHours: string;
  weekendHours: string;
  preferredDays: number[];
}

const INITIAL_DRAFT: Draft = {
  codeforces: '',
  atcoder: '',
  eventName: '',
  eventDate: '',
  eventLocation: '',
  skipEvent: false,
  displayName: '',
  teamName: '',
  weekdayHours: '1',
  weekendHours: '2',
  preferredDays: [0, 1, 2, 3, 4, 5, 6],
};

function hoursToMinutes(value: string): number {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.min(Math.round(parsed * 60), 24 * 60);
}

/** Weekday/weekend hours → the seven-day availability array (index 0 = Sunday). */
function buildAvailability(draft: Draft): number[] {
  const weekday = hoursToMinutes(draft.weekdayHours);
  const weekend = hoursToMinutes(draft.weekendHours);
  return [0, 1, 2, 3, 4, 5, 6].map((day) => {
    if (!draft.preferredDays.includes(day)) return 0;
    return day === 0 || day === 6 ? weekend : weekday;
  });
}

export function Onboarding({ onComplete }: { onComplete: (state: AppState) => void }) {
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<Draft>(INITIAL_DRAFT);
  const [error, setError] = useState<ApiError | Error | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const canAdvance = (): boolean => {
    switch (step) {
      case 1:
        // A handle is optional here; the user may only use one platform.
        return true;
      case 3:
        return draft.skipEvent || (draft.eventName.trim() !== '' && draft.eventDate !== '');
      default:
        return true;
    }
  };

  async function submit(): Promise<void> {
    setSubmitting(true);
    setError(null);
    try {
      const state = await api.completeOnboarding({
        profile: {
          displayName: draft.displayName.trim() || null,
          teamName: draft.teamName.trim() || null,
        },
        handles: {
          codeforces: draft.codeforces.trim() || null,
          atcoder: draft.atcoder.trim() || null,
        },
        targetEvent:
          draft.skipEvent || !draft.eventDate
            ? null
            : {
                name: draft.eventName.trim(),
                date: draft.eventDate,
                location: draft.eventLocation.trim() || null,
              },
        availability: buildAvailability(draft),
        training: { preferredDays: draft.preferredDays },
      });
      onComplete(state);
    } catch (caught) {
      setError(caught instanceof Error ? caught : new Error('Onboarding failed'));
    } finally {
      setSubmitting(false);
    }
  }

  const fieldError = (path: string): string | undefined =>
    error instanceof ApiError ? error.issueFor(path) : undefined;

  const availability = buildAvailability(draft);
  const previewCountdown = draft.eventDate ? computeCountdown(draft.eventDate) : null;

  return (
    <div className="mx-auto flex min-h-full max-w-2xl flex-col justify-center px-6 py-12">
      {/* Step rail */}
      <ol className="mb-6 flex gap-[2px]">
        {STEPS.map((label, index) => (
          <li key={label} className="min-w-0 flex-1">
            <div
              className="h-1 rounded-r-[4px]"
              style={{
                background: index <= step ? 'var(--color-accent)' : 'var(--color-hairline)',
              }}
            />
            <div
              className={`mt-1.5 truncate text-[0.625rem] tracking-wider uppercase ${
                index === step ? 'text-ink-2' : 'text-ink-4'
              }`}
            >
              {label}
            </div>
          </li>
        ))}
      </ol>

      <Panel>
        {step === 0 && (
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-ink">Welcome to Ascend.</h1>
            <p className="mt-3 max-w-prose text-sm leading-relaxed text-ink-2">
              This is a private coach for one thing only: getting you ready for an ICPC
              Regional. It reads your Codeforces, Codeforces Gym and AtCoder history, works out
              what you are actually weak at, and tells you what to train today.
            </p>
            <p className="mt-3 max-w-prose text-sm leading-relaxed text-ink-4">
              Everything stays on this machine. There is no account, no cloud database and no
              public profile. Setup takes about a minute.
            </p>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-4">
            <h1 className="text-xl font-semibold text-ink">Your Codeforces handle</h1>
            <Field
              label="Codeforces handle"
              error={fieldError('codeforces')}
              hint="Used for Codeforces and Codeforces Gym — Gym shares the same identity."
            >
              <input
                className="field"
                value={draft.codeforces}
                onChange={(event) => set('codeforces', event.target.value)}
                placeholder="e.g. tourist"
                autoFocus
                spellCheck={false}
              />
            </Field>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <h1 className="text-xl font-semibold text-ink">Your AtCoder handle</h1>
            <Field
              label="AtCoder handle"
              error={fieldError('atcoder')}
              hint="Optional. Leave it blank if you don't use AtCoder."
            >
              <input
                className="field"
                value={draft.atcoder}
                onChange={(event) => set('atcoder', event.target.value)}
                placeholder="e.g. tourist"
                autoFocus
                spellCheck={false}
              />
            </Field>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <h1 className="text-xl font-semibold text-ink">Your target Regional</h1>
            <p className="max-w-prose text-sm leading-relaxed text-ink-4">
              Ascend will not guess this. The countdown, the training phase and every plan it
              makes are anchored to this date.
            </p>

            <Field label="Contest name" error={fieldError('name')}>
              <input
                className="field"
                value={draft.eventName}
                onChange={(event) => set('eventName', event.target.value)}
                placeholder="ICPC Asia Dhaka Regional"
                disabled={draft.skipEvent}
              />
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Date" error={fieldError('date')}>
                <input
                  type="date"
                  className="field"
                  value={draft.eventDate}
                  onChange={(event) => set('eventDate', event.target.value)}
                  disabled={draft.skipEvent}
                />
              </Field>
              <Field label="Location" error={fieldError('location')}>
                <input
                  className="field"
                  value={draft.eventLocation}
                  onChange={(event) => set('eventLocation', event.target.value)}
                  placeholder="Dhaka"
                  disabled={draft.skipEvent}
                />
              </Field>
            </div>

            {previewCountdown && !draft.skipEvent && (
              <div className="rounded-md border border-hairline bg-plane px-3 py-2 text-sm text-ink-2">
                {countdownHeadline(previewCountdown)}
              </div>
            )}

            <label className="flex items-center gap-2 text-sm text-ink-3">
              <input
                type="checkbox"
                checked={draft.skipEvent}
                onChange={(event) => set('skipEvent', event.target.checked)}
              />
              I don't know my Regional date yet — set it later
            </label>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-4">
            <h1 className="text-xl font-semibold text-ink">How you train</h1>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Your name (optional)">
                <input
                  className="field"
                  value={draft.displayName}
                  onChange={(event) => set('displayName', event.target.value)}
                />
              </Field>
              <Field label="Team name (optional)" hint="Local only — no team sync in V1.">
                <input
                  className="field"
                  value={draft.teamName}
                  onChange={(event) => set('teamName', event.target.value)}
                />
              </Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Hours on a weekday">
                <input
                  className="field"
                  type="number"
                  min="0"
                  max="16"
                  step="0.5"
                  value={draft.weekdayHours}
                  onChange={(event) => set('weekdayHours', event.target.value)}
                />
              </Field>
              <Field label="Hours on a weekend day">
                <input
                  className="field"
                  type="number"
                  min="0"
                  max="16"
                  step="0.5"
                  value={draft.weekendHours}
                  onChange={(event) => set('weekendHours', event.target.value)}
                />
              </Field>
            </div>

            <div>
              <span className="mb-1.5 block text-xs font-medium text-ink-2">Training days</span>
              <div className="flex gap-1.5">
                {[0, 1, 2, 3, 4, 5, 6].map((day) => {
                  const active = draft.preferredDays.includes(day);
                  return (
                    <button
                      key={day}
                      type="button"
                      onClick={() =>
                        set(
                          'preferredDays',
                          active
                            ? draft.preferredDays.filter((d) => d !== day)
                            : [...draft.preferredDays, day].sort((a, b) => a - b),
                        )
                      }
                      className={`flex-1 rounded border px-2 py-1.5 text-xs transition-colors ${
                        active
                          ? 'border-accent bg-accent/15 text-ink'
                          : 'border-hairline-strong text-ink-4 hover:text-ink-2'
                      }`}
                    >
                      {weekdayName(day)}
                    </button>
                  );
                })}
              </div>
              <p className="mt-2 text-xs text-ink-4">
                Weekly budget: {formatMinutes(availability.reduce((sum, m) => sum + m, 0))}
              </p>
            </div>
          </div>
        )}

        {step === 5 && (
          <div className="space-y-4">
            <h1 className="text-xl font-semibold text-ink">Analyse my history</h1>

            <dl className="divide-y divide-hairline text-sm">
              {[
                ['Codeforces', draft.codeforces.trim() || 'not set'],
                ['AtCoder', draft.atcoder.trim() || 'not set'],
                [
                  'Target Regional',
                  draft.skipEvent || !draft.eventDate
                    ? 'to be configured later'
                    : `${draft.eventName.trim()} · ${draft.eventDate}`,
                ],
                ['Weekly budget', formatMinutes(availability.reduce((sum, m) => sum + m, 0))],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between gap-4 py-2">
                  <dt className="text-ink-3">{label}</dt>
                  <dd className="text-right text-ink-2">{value}</dd>
                </div>
              ))}
            </dl>

            <div className="rounded-md border border-hairline bg-plane p-3">
              <p className="text-sm leading-relaxed text-ink-2">
                Saving this configures Ascend and opens the dashboard.
              </p>
              <p className="mt-2 text-sm leading-relaxed text-ink-4">
                The initial analysis of your submission history needs the synchronization engine,
                which is the next milestone of this build. Until it lands, the dashboard will
                honestly report that it has no evidence yet rather than showing you invented
                numbers.
              </p>
            </div>

            {error && (
              <div className="rounded-md border border-critical/40 bg-critical/10 px-3 py-2 text-sm text-ink-2">
                {error.message}
              </div>
            )}
          </div>
        )}

        {/* Navigation */}
        <div className="mt-6 flex items-center justify-between border-t border-hairline pt-4">
          <Button
            variant="ghost"
            onClick={() => setStep((current) => Math.max(0, current - 1))}
            disabled={step === 0 || submitting}
          >
            Back
          </Button>

          {step < STEPS.length - 1 ? (
            <Button
              variant="primary"
              onClick={() => setStep((current) => current + 1)}
              disabled={!canAdvance()}
            >
              Continue
            </Button>
          ) : (
            <Button variant="primary" onClick={() => void submit()} disabled={submitting}>
              {submitting ? 'Saving…' : 'Finish setup'}
            </Button>
          )}
        </div>
      </Panel>
    </div>
  );
}
