import { fileURLToPath } from 'node:url';

import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

import type { AscendDb } from './client';

/** Generated SQL migrations live in `packages/db/drizzle`. */
export function migrationsFolder(): string {
  return fileURLToPath(new URL('../drizzle', import.meta.url));
}

/**
 * Applies any pending migrations. Idempotent — Drizzle records what has already
 * run in its own bookkeeping table, so calling this on every server start is safe.
 */
export function runMigrations(db: AscendDb): void {
  migrate(db, { migrationsFolder: migrationsFolder() });
}
