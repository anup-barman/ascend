import { openDatabase } from '../client';
import { runMigrations } from '../migrate';

/** `pnpm db:migrate` — applies pending migrations to the local database. */
const opened = openDatabase();
try {
  runMigrations(opened.db);
  console.log(`Migrations applied to ${opened.path}`);
} finally {
  opened.close();
}
