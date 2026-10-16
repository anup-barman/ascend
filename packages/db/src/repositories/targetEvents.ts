import { desc, eq } from 'drizzle-orm';

import { isIsoDate, nowEpochSeconds } from '@ascend/core';
import type { TargetEvent } from '@ascend/core';

import type { AscendDb } from '../client';
import { targetEvents } from '../schema';

/**
 * The target ICPC Regional (spec §3).
 *
 * The date is never inferred or defaulted — the spec is explicit that the app
 * must not invent a contest date — so "no active target" is a valid state that
 * the dashboard renders as an empty state rather than a zeroed countdown.
 */

export interface TargetEventInput {
  name: string;
  /** `YYYY-MM-DD`. */
  date: string;
  location?: string | null;
  notes?: string | null;
}

export class InvalidTargetDateError extends Error {
  constructor(readonly date: string) {
    super(`Target date must be a real calendar date in YYYY-MM-DD form, got "${date}"`);
    this.name = 'InvalidTargetDateError';
  }
}

function toTargetEvent(row: typeof targetEvents.$inferSelect): TargetEvent {
  return {
    id: row.id,
    name: row.name,
    date: row.date,
    location: row.location,
    notes: row.notes,
  };
}

export function getActiveTargetEvent(db: AscendDb): TargetEvent | null {
  const row = db
    .select()
    .from(targetEvents)
    .where(eq(targetEvents.isActive, true))
    .orderBy(desc(targetEvents.updatedAt))
    .get();
  return row ? toTargetEvent(row) : null;
}

export function listTargetEvents(db: AscendDb): TargetEvent[] {
  return db.select().from(targetEvents).orderBy(desc(targetEvents.date)).all().map(toTargetEvent);
}

/**
 * Replaces the active target event. Previous events are kept but deactivated,
 * so historical readiness snapshots still make sense against them.
 */
export function setActiveTargetEvent(db: AscendDb, input: TargetEventInput): TargetEvent {
  if (!isIsoDate(input.date)) throw new InvalidTargetDateError(input.date);

  const at = nowEpochSeconds();

  return db.transaction((tx) => {
    tx.update(targetEvents).set({ isActive: false, updatedAt: at }).run();

    const existing = tx.select().from(targetEvents).where(eq(targetEvents.date, input.date)).get();

    if (existing) {
      tx.update(targetEvents)
        .set({
          name: input.name.trim(),
          location: input.location ?? null,
          notes: input.notes ?? null,
          isActive: true,
          updatedAt: at,
        })
        .where(eq(targetEvents.id, existing.id))
        .run();

      const updated = tx.select().from(targetEvents).where(eq(targetEvents.id, existing.id)).get();
      if (!updated) throw new Error('Target event vanished during update');
      return toTargetEvent(updated);
    }

    const inserted = tx
      .insert(targetEvents)
      .values({
        name: input.name.trim(),
        date: input.date,
        location: input.location ?? null,
        notes: input.notes ?? null,
        isActive: true,
        createdAt: at,
        updatedAt: at,
      })
      .returning()
      .get();

    return toTargetEvent(inserted);
  });
}

/** Deactivates every target event, returning the app to its no-target state. */
export function clearActiveTargetEvent(db: AscendDb): void {
  db.update(targetEvents).set({ isActive: false, updatedAt: nowEpochSeconds() }).run();
}
