import { eq } from 'drizzle-orm';

import { nowEpochSeconds } from '@ascend/core';
import type { Provider } from '@ascend/core';

import type { AscendDb } from '../client';
import { availability, platformAccounts, userProfile } from '../schema';

/**
 * The single-user profile, training availability (§53) and platform handles (§1).
 */

export const PROFILE_ID = 1;

export interface Profile {
  displayName: string | null;
  teamName: string | null;
  onboardedAt: number | null;
}

/** Creates the singleton profile row if it does not exist yet. */
export function ensureProfile(db: AscendDb): void {
  const at = nowEpochSeconds();
  db.insert(userProfile)
    .values({ id: PROFILE_ID, createdAt: at, updatedAt: at })
    .onConflictDoNothing()
    .run();
}

export function getProfile(db: AscendDb): Profile {
  const row = db.select().from(userProfile).where(eq(userProfile.id, PROFILE_ID)).get();
  return {
    displayName: row?.displayName ?? null,
    teamName: row?.teamName ?? null,
    onboardedAt: row?.onboardedAt ?? null,
  };
}

export function updateProfile(db: AscendDb, patch: Partial<Profile>): Profile {
  ensureProfile(db);
  db.update(userProfile)
    .set({ ...patch, updatedAt: nowEpochSeconds() })
    .where(eq(userProfile.id, PROFILE_ID))
    .run();
  return getProfile(db);
}

/** Marks onboarding complete. Idempotent — the first completion time is kept. */
export function markOnboarded(db: AscendDb): void {
  ensureProfile(db);
  const current = getProfile(db);
  if (current.onboardedAt !== null) return;
  updateProfile(db, { onboardedAt: nowEpochSeconds() });
}

export function isOnboarded(db: AscendDb): boolean {
  return getProfile(db).onboardedAt !== null;
}

// ---------------------------------------------------------------------------
// Availability (§53 — the planner must fit the time the user actually has)
// ---------------------------------------------------------------------------

/** Minutes available per weekday, index 0 = Sunday. Always length 7. */
export type WeeklyAvailability = number[];

export const DEFAULT_AVAILABILITY: WeeklyAvailability = [120, 60, 60, 60, 60, 60, 120];

export function getAvailability(db: AscendDb): WeeklyAvailability {
  const rows = db.select().from(availability).all();
  const minutes = [...DEFAULT_AVAILABILITY];
  for (const row of rows) {
    if (row.weekday >= 0 && row.weekday <= 6) minutes[row.weekday] = row.minutes;
  }
  return minutes;
}

export function setAvailability(db: AscendDb, minutes: WeeklyAvailability): WeeklyAvailability {
  const at = nowEpochSeconds();
  for (let weekday = 0; weekday <= 6; weekday += 1) {
    const value = minutes[weekday];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) continue;
    const clamped = Math.min(Math.round(value), 24 * 60);
    db.insert(availability)
      .values({ weekday, minutes: clamped, updatedAt: at })
      .onConflictDoUpdate({
        target: availability.weekday,
        set: { minutes: clamped, updatedAt: at },
      })
      .run();
  }
  return getAvailability(db);
}

/** Minutes available on a given weekday (0 = Sunday). */
export function minutesAvailableOn(db: AscendDb, weekday: number): number {
  return getAvailability(db)[weekday] ?? 0;
}

// ---------------------------------------------------------------------------
// Platform accounts (§1 — Codeforces, Codeforces Gym, AtCoder only)
// ---------------------------------------------------------------------------

export interface PlatformAccount {
  provider: Provider;
  handle: string;
  verifiedAt: number | null;
}

export function getPlatformAccounts(db: AscendDb): PlatformAccount[] {
  return db
    .select()
    .from(platformAccounts)
    .all()
    .map((row) => ({
      provider: row.provider,
      handle: row.handle,
      verifiedAt: row.verifiedAt,
    }));
}

export function getHandle(db: AscendDb, provider: Provider): string | null {
  const row = db
    .select()
    .from(platformAccounts)
    .where(eq(platformAccounts.provider, provider))
    .get();
  return row?.handle ?? null;
}

/**
 * Stores a handle. Changing a handle clears `verifiedAt` so the next sync
 * re-confirms it against the platform rather than trusting stale state.
 */
export function upsertPlatformAccount(
  db: AscendDb,
  provider: Provider,
  handle: string,
): PlatformAccount {
  const trimmed = handle.trim();
  const at = nowEpochSeconds();

  db.insert(platformAccounts)
    .values({ provider, handle: trimmed, createdAt: at, updatedAt: at })
    .onConflictDoUpdate({
      target: platformAccounts.provider,
      set: { handle: trimmed, verifiedAt: null, updatedAt: at },
    })
    .run();

  return { provider, handle: trimmed, verifiedAt: null };
}

export function markHandleVerified(db: AscendDb, provider: Provider): void {
  db.update(platformAccounts)
    .set({ verifiedAt: nowEpochSeconds(), updatedAt: nowEpochSeconds() })
    .where(eq(platformAccounts.provider, provider))
    .run();
}

export function removePlatformAccount(db: AscendDb, provider: Provider): void {
  db.delete(platformAccounts).where(eq(platformAccounts.provider, provider)).run();
}
