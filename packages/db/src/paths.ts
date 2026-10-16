import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * Where Ascend keeps user data.
 *
 * Everything lives outside the repository, under `~/.ascend` by default, so the
 * database is never at risk from a `git clean` and never accidentally committed.
 * `ASCEND_DATA_DIR` overrides it, which is what the tests use.
 */
export function dataDir(): string {
  const override = process.env['ASCEND_DATA_DIR'];
  if (override && override.trim() !== '') return resolve(override);
  return join(homedir(), '.ascend');
}

export function databasePath(): string {
  const override = process.env['ASCEND_DB_PATH'];
  if (override && override.trim() !== '') return resolve(override);
  return join(dataDir(), 'ascend.db');
}

/** Encrypted-at-rest credential store (Codeforces session, AI API keys). */
export function secretsPath(): string {
  return join(dataDir(), 'secrets.json');
}

/** Cached provider responses too large or too transient for the database. */
export function cacheDir(): string {
  return join(dataDir(), 'cache');
}
