import type { ReactNode } from 'react';

import type { PreparationUrgency } from '@ascend/core';

/**
 * UI primitives.
 *
 * Mark and figure specs follow the data-viz guidance: meters use a severity
 * fill over a dimmer track of the same hue with a 4px rounded data-end; stat
 * tiles are label / value / delta; there is exactly one hero figure per view;
 * and text always wears an ink token rather than a data or status color, with
 * status carried by a dot plus its label so colour never stands alone.
 */

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

export function Panel({
  title,
  actions,
  children,
  className = '',
}: {
  title?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 border-b border-hairline px-4 py-2.5">
          {title ? <h2 className="eyebrow">{title}</h2> : <span />}
          {actions}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Button({
  children,
  onClick,
  type = 'button',
  variant = 'default',
  disabled = false,
  className = '',
}: {
  children: ReactNode;
  onClick?: () => void;
  type?: 'button' | 'submit';
  variant?: 'default' | 'primary' | 'danger' | 'ghost';
  disabled?: boolean;
  className?: string;
}) {
  const variants: Record<string, string> = {
    default: 'bg-raised border-hairline-strong text-ink hover:border-ink-4',
    primary: 'bg-accent border-accent text-white hover:brightness-110',
    danger: 'bg-transparent border-critical text-critical hover:bg-critical/10',
    ghost: 'bg-transparent border-transparent text-ink-3 hover:text-ink',
  };

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`rounded-md border px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${variants[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: ReactNode;
  error?: string | undefined;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-ink-2">{label}</span>
      {children}
      {error ? (
        <span className="mt-1 block text-xs text-critical">{error}</span>
      ) : hint ? (
        <span className="mt-1 block text-xs leading-relaxed text-ink-4">{hint}</span>
      ) : null}
    </label>
  );
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

export type Severity = 'good' | 'warning' | 'serious' | 'critical' | 'unknown';

const SEVERITY_FILL: Record<Severity, string> = {
  good: 'var(--color-good)',
  warning: 'var(--color-warning)',
  serious: 'var(--color-serious)',
  critical: 'var(--color-critical)',
  unknown: 'var(--color-ink-4)',
};

/** A status dot always sits beside its own label — never colour alone. */
export function StatusDot({ severity }: { severity: Severity }) {
  return (
    <span
      aria-hidden
      className="inline-block size-2 shrink-0 rounded-full"
      style={{ background: SEVERITY_FILL[severity] }}
    />
  );
}

export function Chip({
  severity = 'unknown',
  children,
}: {
  severity?: Severity;
  children: ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded border border-hairline-strong bg-raised px-2 py-1 text-[0.6875rem] font-semibold tracking-wider uppercase text-ink-2">
      <StatusDot severity={severity} />
      {children}
    </span>
  );
}

/** Urgency band → severity. Near the Regional is genuinely more critical (§54). */
export function urgencySeverity(urgency: PreparationUrgency): Severity {
  switch (urgency) {
    case 'FINAL_3':
    case 'FINAL_14':
      return 'critical';
    case 'IMMINENT':
      return 'serious';
    case 'APPROACHING':
      return 'warning';
    case 'DISTANT':
      return 'good';
    case 'PAST':
    case 'NO_TARGET':
      return 'unknown';
  }
}

export const URGENCY_LABELS: Record<PreparationUrgency, string> = {
  NO_TARGET: 'No target set',
  DISTANT: 'Distant',
  APPROACHING: 'Approaching',
  IMMINENT: 'Imminent',
  FINAL_14: 'Final 14 days',
  FINAL_3: 'Final 3 days',
  PAST: 'Past',
};

// ---------------------------------------------------------------------------
// Figures
// ---------------------------------------------------------------------------

/**
 * The one number a view leads with. Proportional figures — `tabular-nums` makes
 * a large value look loose.
 */
export function HeroFigure({
  value,
  unit,
  caption,
}: {
  value: string;
  unit?: string;
  caption?: ReactNode;
}) {
  return (
    <div>
      <div className="flex items-baseline gap-2">
        <span className="text-6xl leading-none font-semibold tracking-tight text-ink">{value}</span>
        {unit && <span className="text-lg font-medium text-ink-3">{unit}</span>}
      </div>
      {caption && <div className="mt-2 text-sm text-ink-3">{caption}</div>}
    </div>
  );
}

export function StatTile({
  label,
  value,
  delta,
  deltaGood,
  hint,
}: {
  label: string;
  /** Already formatted, or null when there is no evidence for a number. */
  value: string | null;
  delta?: string;
  /** Whether the delta's direction is a good thing. */
  deltaGood?: boolean;
  hint?: string;
}) {
  return (
    <div className="panel min-w-0 px-4 py-3">
      <div className="text-xs text-ink-3">{label}</div>
      <div className="mt-1 flex items-baseline gap-2">
        {/* Values are user-supplied (handles), so the tile truncates rather than
            widening the grid and pushing a scrollbar onto the whole page. */}
        <span className="min-w-0 truncate text-2xl font-semibold text-ink" title={value ?? undefined}>
          {value ?? <span className="text-ink-4">—</span>}
        </span>
        {delta && (
          <span
            className="text-xs font-medium"
            style={{
              color: deltaGood ? 'var(--color-good)' : 'var(--color-critical)',
            }}
          >
            {delta}
          </span>
        )}
      </div>
      {hint && <div className="mt-1 text-[0.6875rem] leading-snug text-ink-4">{hint}</div>}
    </div>
  );
}

/** Readiness band → severity. Used for meter fills. */
export function readinessSeverity(value: number | null): Severity {
  if (value === null) return 'unknown';
  if (value >= 0.75) return 'good';
  if (value >= 0.6) return 'warning';
  if (value >= 0.4) return 'serious';
  return 'critical';
}

/**
 * A single readiness dimension.
 *
 * `value === null` is a first-class state: the spec forbids fake precision (§5)
 * and inventing user performance (§58), so a dimension without enough evidence
 * shows an em dash and says what it still needs — never 0%.
 */
export function Meter({
  label,
  value,
  evidenceNeeded,
}: {
  label: string;
  value: number | null;
  evidenceNeeded?: number;
}) {
  const severity = readinessSeverity(value);
  const fill = SEVERITY_FILL[severity];
  const percent = value === null ? 0 : Math.round(value * 100);

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="truncate text-sm text-ink-2">{label}</span>
        <span className="tnum text-sm font-semibold text-ink">
          {value === null ? <span className="text-ink-4">—</span> : `${percent}%`}
        </span>
      </div>

      {/* Track is a dimmer step of the fill's own hue, so state reads across
          the whole bar; the fill grows from a square baseline to a 4px end. */}
      <div
        className="mt-1.5 h-1.5 w-full overflow-hidden rounded-r-[4px]"
        style={{ background: value === null ? 'var(--color-hairline)' : `${fill}22` }}
        role="meter"
        aria-valuenow={value === null ? undefined : percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
      >
        {value !== null && (
          <div
            className="h-full rounded-r-[4px]"
            style={{ width: `${percent}%`, background: fill }}
          />
        )}
      </div>

      {value === null && evidenceNeeded !== undefined && evidenceNeeded > 0 && (
        <div className="mt-1 text-[0.6875rem] text-ink-4">
          needs {evidenceNeeded} more {evidenceNeeded === 1 ? 'observation' : 'observations'}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Explainability and honesty
// ---------------------------------------------------------------------------

/** The evidence list behind every recommendation (§36, §46). */
export function EvidenceList({ items }: { items: { label: string; value: string }[] }) {
  return (
    <ul className="space-y-1.5">
      {items.map((item) => (
        <li key={item.label} className="flex items-baseline justify-between gap-4 text-sm">
          <span className="text-ink-3">{item.label}</span>
          <span className="tnum text-right font-medium text-ink-2">{item.value}</span>
        </li>
      ))}
    </ul>
  );
}

export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-md border border-dashed border-hairline-strong px-4 py-5">
      <div>
        <div className="text-sm font-medium text-ink-2">{title}</div>
        {children && <div className="mt-1 max-w-prose text-sm leading-relaxed text-ink-4">{children}</div>}
      </div>
      {action}
    </div>
  );
}

/**
 * An honest placeholder for a screen that has not been built yet.
 *
 * It deliberately shows no numbers at all. Showing plausible-looking sample data
 * would violate §58, and it would make it impossible to tell a real reading from
 * a mock one.
 */
export function NotYetBuilt({
  milestone,
  what,
  needs,
}: {
  milestone: string;
  what: string;
  needs?: string;
}) {
  return (
    <div className="panel p-6">
      <Chip>{milestone}</Chip>
      <p className="mt-3 max-w-prose text-sm leading-relaxed text-ink-2">{what}</p>
      {needs && (
        <p className="mt-2 max-w-prose text-sm leading-relaxed text-ink-4">
          Blocked on: {needs}
        </p>
      )}
      <p className="mt-4 max-w-prose text-xs leading-relaxed text-ink-4">
        Nothing is shown here yet on purpose. Ascend never displays placeholder statistics —
        every number in this app comes from your own synchronized history.
      </p>
    </div>
  );
}
