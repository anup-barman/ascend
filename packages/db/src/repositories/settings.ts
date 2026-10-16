import { eq } from 'drizzle-orm';

import { mergeSettings, nowEpochSeconds, SETTINGS_SECTIONS } from '@ascend/core';
import type { AscendSettings, SettingsPatch } from '@ascend/core';

import type { AscendDb } from '../client';
import { settings } from '../schema';

/**
 * Persistence for application settings (spec §64).
 *
 * The shape and defaults live in `@ascend/core` so the browser can share them;
 * this module only stores and retrieves. One row per top-level section, so a
 * partial update never rewrites unrelated configuration.
 */

export function getSettings(db: AscendDb): AscendSettings {
  const rows = db.select().from(settings).all();
  return mergeSettings(new Map(rows.map((row) => [row.key, row.value])));
}

/** Applies a section-wise patch and returns the full effective settings. */
export function updateSettings(db: AscendDb, patch: SettingsPatch): AscendSettings {
  const current = getSettings(db);
  const at = nowEpochSeconds();

  for (const key of SETTINGS_SECTIONS) {
    const section = patch[key];
    if (section === undefined) continue;

    const next = { ...current[key], ...section };
    db.insert(settings)
      .values({ key, value: next, updatedAt: at })
      .onConflictDoUpdate({
        target: settings.key,
        set: { value: next, updatedAt: at },
      })
      .run();
  }

  return getSettings(db);
}

/** Reads a single raw setting, for values outside the typed sections. */
export function getRawSetting<T = unknown>(db: AscendDb, key: string): T | undefined {
  const row = db.select().from(settings).where(eq(settings.key, key)).get();
  return row?.value as T | undefined;
}

export function setRawSetting(db: AscendDb, key: string, value: unknown): void {
  const at = nowEpochSeconds();
  db.insert(settings)
    .values({ key, value, updatedAt: at })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: at } })
    .run();
}
