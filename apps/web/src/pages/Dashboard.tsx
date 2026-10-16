import { Link } from 'react-router-dom';

import {
  PHASE_GUIDANCE,
  PHASE_LABELS,
  PREPARATION_PHASES,
  READINESS_DIMENSION_LABELS,
  READINESS_DIMENSIONS,
  phaseIndex,
} from '@ascend/core';

import type { AppState } from '../api';
import { formatMinutes, relativeTime, weekdayName } from '../format';
import { SyncPanel } from '../components/SyncPanel';
import type { SyncStream } from '../useSyncStream';
import {
  Button,
  Chip,
  EmptyState,
  HeroFigure,
  Meter,
  Panel,
  StatTile,
  URGENCY_LABELS,
  urgencySeverity,
} from '../components/ui';

/**
 * The Regional readiness dashboard (spec §28, §29).
 *
 * The screen must answer "what should I do today?" first. Until history has been
 * synchronized there is genuinely nothing to answer it with, so this view says
 * so plainly instead of filling the space with plausible-looking numbers —
 * §43 wants decisions, and §58 forbids inventing performance.
 */

function PhasePanel({ state }: { state: AppState }) {
  const { phase } = state;
  if (!phase) return null;

  const currentIndex = phaseIndex(phase.phase);

  return (
    <Panel title="Preparation phase">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-lg font-semibold text-ink">{PHASE_LABELS[phase.phase]}</span>
        {phase.calendarPhase && phase.calendarPhase !== phase.phase && (
          <span className="text-xs text-ink-4">
            calendar alone would say {PHASE_LABELS[phase.calendarPhase]}
          </span>
        )}
      </div>

      {/* Phase progression. Segments are separated by a 2px surface gap. */}
      <div className="mt-3 flex gap-[2px]">
        {PREPARATION_PHASES.map((candidate, index) => (
          <div
            key={candidate}
            title={PHASE_LABELS[candidate]}
            className="h-1.5 flex-1 rounded-r-[4px]"
            style={{
              background:
                index <= currentIndex ? 'var(--color-accent)' : 'var(--color-hairline)',
            }}
          />
        ))}
      </div>
      <div className="mt-1.5 flex justify-between text-[0.625rem] tracking-wider text-ink-4 uppercase">
        <span>{PHASE_LABELS[PREPARATION_PHASES[0]]}</span>
        <span>{PHASE_LABELS[PREPARATION_PHASES[PREPARATION_PHASES.length - 1]!]}</span>
      </div>

      {/* Why this phase (§46) — real reasoning from the phase engine. */}
      {(phase.overrides.length > 0 || phase.reasons.length > 0) && (
        <div className="mt-4 border-t border-hairline pt-3">
          <div className="eyebrow mb-2">Why this phase</div>
          <ul className="space-y-1.5">
            {phase.overrides.map((reason) => (
              <li key={reason} className="flex gap-2 text-sm leading-relaxed text-ink-2">
                <span className="text-critical">!</span>
                {reason}
              </li>
            ))}
            {phase.reasons.map((reason) => (
              <li key={reason} className="flex gap-2 text-sm leading-relaxed text-ink-3">
                <span className="text-ink-4">·</span>
                {reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-4 grid gap-3 border-t border-hairline pt-3 sm:grid-cols-2">
        <div>
          <div className="eyebrow mb-1.5">Prioritise</div>
          <ul className="space-y-0.5 text-sm text-ink-2">
            {PHASE_GUIDANCE[phase.phase].prioritise.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
        <div>
          <div className="eyebrow mb-1.5">Suppress</div>
          <ul className="space-y-0.5 text-sm text-ink-4">
            {PHASE_GUIDANCE[phase.phase].suppress.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      </div>
    </Panel>
  );
}

function ReadinessPanel({ hasData }: { hasData: boolean }) {
  return (
    <Panel title="Readiness">
      <div className="mb-4 flex items-baseline gap-3">
        <span className="text-3xl font-semibold text-ink-4">—</span>
        <span className="text-sm text-ink-4">
          {hasData ? 'not yet computed' : 'no synchronized history'}
        </span>
      </div>

      <div className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
        {READINESS_DIMENSIONS.map((dimension) => (
          <Meter
            key={dimension}
            label={READINESS_DIMENSION_LABELS[dimension]}
            value={null}
          />
        ))}
      </div>

      <p className="mt-4 border-t border-hairline pt-3 text-xs leading-relaxed text-ink-4">
        Every dimension shows an em dash until there is enough evidence behind it. Ascend does
        not report a percentage it cannot defend, and it will show you the submissions behind
        each figure once they exist.
      </p>
    </Panel>
  );
}

export function Dashboard({ state, sync }: { state: AppState; sync: SyncStream }) {
  const { countdown, targetEvent } = state;
  const needsHandles = sync.view.needsHandles;
  // The oldest success across the configured providers — the honest moment the
  // whole picture was last true, not the most flattering one. Null until every
  // configured provider has succeeded at least once.
  const configured = sync.view.providers.filter((provider) => provider.configured);
  const successes = configured
    .map((provider) => provider.lastSuccessAt)
    .filter((at): at is number => at !== null);
  const lastSynced =
    configured.length > 0 && successes.length === configured.length ? Math.min(...successes) : null;

  return (
    <div className="space-y-6">
      {/* --- Hero: the one number this view leads with -------------------- */}
      <section className="panel p-6">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <div className="eyebrow mb-2">
              {targetEvent ? targetEvent.name : 'Target contest'}
            </div>

            {countdown.daysRemaining === null ? (
              <>
                <HeroFigure value="—" caption="No target contest configured" />
                <p className="mt-3 max-w-prose text-sm leading-relaxed text-ink-3">
                  Ascend will not invent a date for you. Set your Regional and the whole
                  application starts counting toward it.
                </p>
                <Link to="/settings" className="mt-3 inline-block">
                  <Button variant="primary">Set target Regional</Button>
                </Link>
              </>
            ) : (
              <HeroFigure
                value={String(Math.abs(countdown.daysRemaining))}
                unit={
                  Math.abs(countdown.daysRemaining) === 1
                    ? countdown.daysRemaining < 0
                      ? 'day since'
                      : 'day to go'
                    : countdown.daysRemaining < 0
                      ? 'days since'
                      : 'days to go'
                }
                caption={
                  <span className="flex flex-wrap items-center gap-2">
                    <Chip severity={urgencySeverity(countdown.urgency)}>
                      {URGENCY_LABELS[countdown.urgency]}
                    </Chip>
                    {countdown.weeksRemaining !== null && (
                      <span className="text-ink-4">
                        {countdown.weeksRemaining}{' '}
                        {countdown.weeksRemaining === 1 ? 'week' : 'weeks'} of training left
                      </span>
                    )}
                  </span>
                }
              />
            )}
          </div>

          {/* Configuration state — real, checkable facts only. */}
          <div className="grid w-full max-w-md grid-cols-2 gap-3">
            <StatTile
              label="Codeforces handle"
              value={state.handles.codeforces}
              hint={state.handles.codeforces ? undefined : 'not configured'}
            />
            <StatTile
              label="AtCoder handle"
              value={state.handles.atcoder}
              hint={state.handles.atcoder ? undefined : 'not configured'}
            />
            <StatTile
              label="Last synchronized"
              value={lastSynced === null ? null : relativeTime(lastSynced)}
              hint={lastSynced === null ? 'no history fetched yet' : sync.view.statusLabel}
            />
            <StatTile
              label="Weekly training budget"
              value={formatMinutes(state.availability.reduce((sum, m) => sum + m, 0))}
            />
          </div>
        </div>
      </section>

      <SyncPanel sync={sync} />

      {/* --- Today's mission ---------------------------------------------- */}
      <Panel title="Today's mission">
        {needsHandles ? (
          <EmptyState
            title="No platform handles configured"
            action={
              <Link to="/settings">
                <Button variant="primary">Add handles</Button>
              </Link>
            }
          >
            Ascend builds today's plan from your own submission history. Add your Codeforces
            and AtCoder handles and it will analyse what you have actually been doing.
          </EmptyState>
        ) : lastSynced === null ? (
          <EmptyState
            title="Waiting on your first synchronization"
            action={
              <Button
                variant="primary"
                onClick={sync.start}
                disabled={sync.view.running || sync.starting}
              >
                {sync.view.running ? 'Syncing…' : 'Sync now'}
              </Button>
            }
          >
            Handles are configured, but no history has been fetched yet. Ascend reads your
            Codeforces, Codeforces Gym and AtCoder submissions and plans from what you have
            actually been doing — until that history is here it has no evidence to plan from,
            and inventing a plan would defeat the point.
          </EmptyState>
        ) : (
          <EmptyState title="No plan yet — the planner is the next milestone">
            Your history is synchronized. Deciding what to train today — the daily router, the
            session planner and the problem recommender — is still being built, and a guess
            dressed up as a plan would be worse than nothing.
          </EmptyState>
        )}
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        <ReadinessPanel hasData={lastSynced !== null} />

        <div className="space-y-6">
          <PhasePanel state={state} />

          <Panel title="Biggest weaknesses">
            <EmptyState title="Nothing detected yet">
              Weaknesses are inferred from patterns in your submissions — repeated wrong
              answers, slow-but-correct solves, topics that decayed since you last practised
              them. That needs synchronized history first.
            </EmptyState>
          </Panel>
        </div>
      </div>

      {/* --- Training week (real configuration) --------------------------- */}
      <Panel title="Training week">
        <div className="grid grid-cols-7 gap-[2px]">
          {state.availability.map((minutes, weekday) => {
            const max = Math.max(...state.availability, 1);
            return (
              <div key={weekday} className="text-center">
                <div className="flex h-24 items-end justify-center">
                  <div
                    className="w-6 rounded-t-[4px]"
                    style={{
                      height: `${Math.max(2, (minutes / max) * 100)}%`,
                      background:
                        minutes > 0 ? 'var(--color-accent)' : 'var(--color-hairline)',
                    }}
                  />
                </div>
                <div className="mt-2 text-[0.625rem] tracking-wider text-ink-4 uppercase">
                  {weekdayName(weekday)}
                </div>
                <div className="tnum text-xs text-ink-3">{formatMinutes(minutes)}</div>
              </div>
            );
          })}
        </div>
        <p className="mt-3 border-t border-hairline pt-3 text-xs leading-relaxed text-ink-4">
          The planner will fit each day's session inside this budget — a 45-minute day never
          gets a four-hour plan.
        </p>
      </Panel>
    </div>
  );
}
