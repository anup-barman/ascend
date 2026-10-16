import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

import { databasePath } from './paths';
import * as schema from './schema';

export type Schema = typeof schema;

/** The typed Drizzle handle every repository takes as its first argument. */
export type AscendDb = BetterSQLite3Database<Schema>;
export type SqliteHandle = Database.Database;

export interface OpenedDatabase {
  db: AscendDb;
  sqlite: SqliteHandle;
  path: string;
  close: () => void;
}

/**
 * Opens (creating if necessary) the local SQLite database.
 *
 * `:memory:` is accepted so tests can run against a throwaway database.
 */
export function openDatabase(path: string = databasePath()): OpenedDatabase {
  if (path !== ':memory:') {
    // 0o700: the database holds the user's entire training history.
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  }

  const sqlite = new Database(path);

  // WAL keeps reads from blocking the background sync writer.
  if (path !== ':memory:') sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');

  const db = drizzle(sqlite, { schema });

  return {
    db,
    sqlite,
    path,
    close: () => sqlite.close(),
  };
}

let singleton: OpenedDatabase | null = null;

/** Process-wide database handle, used by the server. */
export function getDatabase(): OpenedDatabase {
  singleton ??= openDatabase();
  return singleton;
}

export function closeDatabase(): void {
  singleton?.close();
  singleton = null;
}
