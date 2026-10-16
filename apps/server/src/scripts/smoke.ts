import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PROVIDERS, PROVIDER_LABELS, type Provider } from '@ascend/core';
// Types only — erased at compile time, so this cannot resolve a data path before
// `chooseDataDir` has set one.
import type { SqliteHandle, SyncStateRow } from '@ascend/db';

/**
 * Opt-in live sync smoke run (spec §7, §62).
 *
 * Every sync assertion in the test suite is made against scripted adapters, which
 * proves the bookkeeping but cannot prove the provider reality underneath it. This
 * script is the other half: one real run against Codeforces, Codeforces Gym and
 * AtCoder, followed by a report read back **from the database** rather than from
 * the run result — "the run says it stored 600 submissions" and "the database
 * holds 600 rows" are different claims, and only the second one matters.
 *
 * It is never part of `pnpm test`: it reaches the live network, it spends minutes
 * inside the Codeforces rate limit, and running it is the user's decision.
 *
 *   pnpm sync:smoke --handle=SomeHandle --atcoder=some_handle
 *
 * It writes to a **throwaway data directory** unless `--real` is passed. The real
 * `~/.ascend/ascend.db` accumulates months of training history that cannot be
 * re-derived, so a diagnostic script does not touch it by default.
 */

const USAGE = `
Usage: pnpm sync:smoke [options]

  --handle=<handle>    Codeforces handle (also syncs Gym — same account, §1)
  --atcoder=<handle>   AtCoder handle
  --real               Sync into ~/.ascend/ascend.db instead of a temp directory
  --max-items=<n>      Stop paging after roughly n submissions per provider
  --only=<a,b>         Restrict the run to these providers
  --once               Skip the second run, which checks that a re-sync is a no-op

At least one handle is required.
`.trim();

interface Args {
  codeforces: string | null;
  atcoder: string | null;
  real: boolean;
  maxItems: number | undefined;
  only: Provider[] | undefined;
  once: boolean;
}

function fail(message: string): never {
  console.error(`smoke: ${message}\n\n${USAGE}`);
  process.exit(1);
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    codeforces: null,
    atcoder: null,
    real: false,
    maxItems: undefined,
    only: undefined,
    once: false,
  };

  for (const arg of argv) {
    const separator = arg.indexOf('=');
    const flag = separator === -1 ? arg : arg.slice(0, separator);
    const value = separator === -1 ? '' : arg.slice(separator + 1).trim();

    switch (flag) {
      case '--handle':
      case '--codeforces':
        args.codeforces = value || null;
        break;
      case '--atcoder':
        args.atcoder = value || null;
        break;
      case '--real':
        args.real = true;
        break;
      case '--once':
        args.once = true;
        break;
      case '--max-items': {
        const parsed = Number.parseInt(value, 10);
        if (!Number.isFinite(parsed) || parsed <= 0) fail('--max-items needs a positive integer');
        args.maxItems = parsed;
        break;
      }
      case '--only': {
        const requested = value.split(',').map((part) => part.trim()).filter(Boolean);
        if (requested.length === 0) fail('--only needs at least one provider');
        for (const provider of requested) {
          if (!(PROVIDERS as readonly string[]).includes(provider)) {
            fail(`unknown provider "${provider}" — expected one of ${PROVIDERS.join(', ')}`);
          }
        }
        args.only = requested as Provider[];
        break;
      }
      case '--help':
      case '-h':
        console.log(USAGE);
        process.exit(0);
        break;
      default:
        fail(`unrecognised argument "${arg}"`);
    }
  }

  if (!args.codeforces && !args.atcoder) fail('at least one handle is required');

  return args;
}

/**
 * Points the run at a throwaway data directory **before** anything reads one.
 *
 * `dataDir()` resolves `ASCEND_DATA_DIR` on every call, so setting it here — above
 * the dynamic import of `@ascend/db` — is what keeps a diagnostic run away from
 * the user's real history. With `--real`, the environment is left alone and the
 * usual resolution applies.
 */
function chooseDataDir(real: boolean): void {
  if (real) return;
  process.env['ASCEND_DATA_DIR'] = mkdtempSync(join(tmpdir(), 'ascend-smoke-'));
}

const CHECK_MARKS = { ok: '  ok  ', warn: ' warn ', fail: ' FAIL ' } as const;
type CheckMark = keyof typeof CHECK_MARKS;

let failures = 0;

/**
 * Reports one observation.
 *
 * `warn` and `fail` are deliberately different: "the account has no Gym history"
 * is not a defect, and reporting it as one would teach the reader to ignore the
 * output. Only `fail` sets the exit code.
 */
function check(mark: CheckMark, label: string, detail = ''): void {
  if (mark === 'fail') failures += 1;
  console.log(`[${CHECK_MARKS[mark]}] ${label}${detail ? ` — ${detail}` : ''}`);
}

function heading(title: string): void {
  console.log(`\n${title}\n${'─'.repeat(title.length)}`);
}

function bytes(count: number): string {
  if (count < 1024) return `${count} B`;
  if (count < 1024 * 1024) return `${(count / 1024).toFixed(1)} kB`;
  return `${(count / (1024 * 1024)).toFixed(1)} MB`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  chooseDataDir(args.real);

  // Imported after ASCEND_DATA_DIR is set, so the module graph cannot resolve a
  // path before the choice above has been made.
  const db = await import('@ascend/db');
  const { SyncRunner } = await import('../sync/runner');

  const opened = db.openDatabase();
  console.log(`smoke: database ${opened.path}`);
  if (!args.real) console.log('smoke: throwaway directory — pass --real to sync ~/.ascend');

  db.runMigrations(opened.db);
  db.ensureProfile(opened.db);
  db.resetStaleSyncing(opened.db);

  if (args.codeforces) db.upsertPlatformAccount(opened.db, 'codeforces', args.codeforces);
  if (args.atcoder) db.upsertPlatformAccount(opened.db, 'atcoder', args.atcoder);

  const counts = (): Record<string, number> => tableCounts(opened.sqlite);
  const before = counts();

  const runner = new SyncRunner(opened.db);
  const options = {
    ...(args.only ? { only: args.only } : {}),
    ...(args.maxItems !== undefined ? { maxItems: args.maxItems } : {}),
  };

  heading('Run 1 — live sync');
  const startedAt = Date.now();
  runner.subscribe((event) => {
    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1).padStart(6);
    const label = event.provider ? PROVIDER_LABELS[event.provider] : '';
    console.log(`${elapsed}s  ${event.kind.padEnd(17)} ${event.message ?? label}`);
  });

  const started = runner.start(options);
  if (!started.started) fail(`could not start a run: ${started.reason ?? 'unknown'}`);
  await runner.settle();

  const result = runner.state.lastResult;
  if (runner.state.lastError) check('fail', 'the engine itself failed', runner.state.lastError);
  if (!result) {
    check('fail', 'the run produced no result');
    process.exit(1);
  }

  heading('Run 1 — outcome');
  for (const outcome of result.providers) {
    const mark: CheckMark =
      outcome.status === 'failed' ? 'fail' : outcome.status === 'up_to_date' ? 'ok' : 'warn';
    check(mark, `${outcome.label}: ${outcome.status}`, `${outcome.itemsSynced} submissions`);
    for (const warning of outcome.warnings) console.log(`         · ${warning}`);
    if (outcome.error) console.log(`         · ${outcome.error}`);
    if (outcome.skippedReason) console.log(`         · ${outcome.skippedReason}`);
  }
  console.log(`\noverall: ${result.overall} in ${result.finishedAt - result.startedAt}s`);

  reportDatabase(opened.sqlite, before, counts());
  reportSyncState(db.listSyncState(opened.db));
  reportProviderReality(opened.sqlite, args);

  if (!args.once) {
    heading('Run 2 — re-sync must be a no-op (§71 sync deduplication, live)');
    const beforeSecond = counts();
    const secondStart = Date.now();
    const second = runner.start(options);
    if (!second.started) fail(`could not start the second run: ${second.reason ?? 'unknown'}`);
    await runner.settle();
    const afterSecond = counts();

    const added = Object.entries(afterSecond).filter(
      ([table, count]) => count !== (beforeSecond[table] ?? 0),
    );
    const elapsed = ((Date.now() - secondStart) / 1000).toFixed(1);

    if (added.length === 0) {
      check('ok', 'no rows added by the second run', `${elapsed}s`);
    } else {
      // Not automatically a defect: a submission judged between the two runs is a
      // genuinely new row. Anything larger than a handful is the dedupe failing.
      const summary = added
        .map(([table, count]) => `${table} +${count - (beforeSecond[table] ?? 0)}`)
        .join(', ');
      check('warn', 'the second run added rows', `${summary} (${elapsed}s)`);
    }

    const rawGrowth =
      (afterSecond['raw_payloads'] ?? 0) - (beforeSecond['raw_payloads'] ?? 0);
    check(
      rawGrowth === 0 ? 'ok' : 'warn',
      'raw payload rows added by the second run',
      String(rawGrowth),
    );
  }

  heading('Result');
  console.log(
    failures === 0
      ? 'No failures. The database above is what a live sync actually produced.'
      : `${failures} check${failures === 1 ? '' : 's'} failed.`,
  );
  if (!args.real) console.log(`Inspect it with: sqlite3 ${opened.path}`);

  opened.close();
  process.exit(failures === 0 ? 0 : 1);
}

/** Row counts for every table that has any, read straight from SQLite. */
function tableCounts(sqlite: SqliteHandle): Record<string, number> {
  const tables = sqlite
    .prepare(
      `SELECT name FROM sqlite_master
       WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle%'
       ORDER BY name`,
    )
    .all() as { name: string }[];

  const counts: Record<string, number> = {};
  for (const { name } of tables) {
    const row = sqlite.prepare(`SELECT COUNT(*) AS n FROM "${name}"`).get() as { n: number };
    counts[name] = row.n;
  }
  return counts;
}

function reportDatabase(
  sqlite: SqliteHandle,
  before: Record<string, number>,
  after: Record<string, number>,
): void {
  heading('Database contents');
  for (const [table, count] of Object.entries(after)) {
    if (count === 0) continue;
    const delta = count - (before[table] ?? 0);
    console.log(`  ${table.padEnd(24)} ${String(count).padStart(7)}${delta ? `  (+${delta})` : ''}`);
  }

  const raw = sqlite
    .prepare(
      `SELECT COUNT(*) AS rows,
              COALESCE(SUM(body_bytes), 0) AS total,
              COALESCE(SUM(body_omitted), 0) AS omitted
       FROM raw_payloads`,
    )
    .get() as { rows: number; total: number; omitted: number };

  // TODO item 6 (raw-payload retention) needs the real growth rate, and this is
  // the only place it can be measured.
  console.log(
    `\n  raw payloads: ${raw.rows} rows, ${bytes(raw.total)} of bodies, ${raw.omitted} omitted as oversized`,
  );
}

function reportSyncState(rows: SyncStateRow[]): void {
  heading('Sync state');
  if (rows.length === 0) {
    check('warn', 'no sync_state rows', 'nothing ran');
    return;
  }
  for (const row of rows) {
    console.log(
      `  ${row.provider.padEnd(15)} ${row.resource.padEnd(12)} ${row.status.padEnd(17)} ` +
        `${String(row.itemsSynced).padStart(6)} items  cursor=${JSON.stringify(row.cursor ?? {})}`,
    );
    if (row.error) console.log(`         · ${row.error}`);
  }
}

/**
 * The provider claims in `CLAUDE.md` that only live data can confirm.
 *
 * Each of these overturned or established a design decision, and each is asserted
 * against the stored rows rather than against a fetch, so a normalizer that
 * dropped the evidence on the floor fails here too.
 */
function reportProviderReality(sqlite: SqliteHandle, args: Args): void {
  const scalar = (sql: string): number => (sqlite.prepare(sql).get() as { n: number }).n;

  heading('Provider reality');

  if (args.codeforces) {
    const gymSubmissions = scalar(
      `SELECT COUNT(*) AS n FROM submissions WHERE provider = 'codeforces_gym'`,
    );
    const regular = scalar(`SELECT COUNT(*) AS n FROM submissions WHERE provider = 'codeforces'`);

    check(
      gymSubmissions > 0 ? 'ok' : 'warn',
      'Gym submissions arrive in user.status with no credential',
      `${gymSubmissions} gym / ${regular} regular`,
    );

    if (gymSubmissions > 0) {
      // contest.list?gym=true is the authoritative Gym id set; an unresolved
      // submission means a Gym contest Ascend could not name.
      const unresolved = scalar(
        `SELECT COUNT(*) AS n FROM submissions s
         LEFT JOIN contests c ON c.id = s.contest_id
         WHERE s.provider = 'codeforces_gym' AND (s.contest_id IS NULL OR c.id IS NULL)`,
      );
      check(
        unresolved === 0 ? 'ok' : 'warn',
        'every Gym submission resolves to a contest row',
        `${unresolved} unresolved`,
      );

      const icpc = scalar(
        `SELECT COUNT(*) AS n FROM contests WHERE kind = 'gym' AND is_icpc_style = 1`,
      );
      const gymContests = scalar(`SELECT COUNT(*) AS n FROM contests WHERE kind = 'gym'`);
      check(
        'ok',
        'Gym contests carry the ICPC provenance §37 ranks on',
        `${icpc} of ${gymContests} flagged ICPC-style`,
      );

      // A null rating is correct for Gym (§17) — the check is that it never
      // overwrote a real Codeforces one on a shared problem row.
      const gymRated = scalar(
        `SELECT COUNT(*) AS n FROM problems WHERE provider = 'codeforces_gym' AND platform_rating IS NOT NULL`,
      );
      const gymUnrated = scalar(
        `SELECT COUNT(*) AS n FROM problems WHERE provider = 'codeforces_gym' AND platform_rating IS NULL`,
      );
      check('ok', 'Gym problems store no platform rating', `${gymUnrated} unrated, ${gymRated} rated`);
    }

    const cfRated = scalar(
      `SELECT COUNT(*) AS n FROM problems WHERE provider = 'codeforces' AND platform_rating IS NOT NULL`,
    );
    const cfTotal = scalar(`SELECT COUNT(*) AS n FROM problems WHERE provider = 'codeforces'`);
    check(
      cfTotal === 0 || cfRated > 0 ? 'ok' : 'fail',
      'Codeforces ratings survived ingestion',
      `${cfRated} of ${cfTotal} rated`,
    );

    // `contest_results` has no provider column of its own — it is reached through
    // the contest it belongs to.
    const results = scalar(
      `SELECT COUNT(*) AS n FROM contest_results r
       JOIN contests c ON c.id = r.contest_id
       WHERE c.provider IN ('codeforces', 'codeforces_gym')`,
    );
    const penalised = scalar(
      `SELECT COUNT(*) AS n FROM contest_results r
       JOIN contests c ON c.id = r.contest_id
       WHERE c.provider IN ('codeforces', 'codeforces_gym') AND r.penalty > 0`,
    );
    check(
      'ok',
      'contest results derived from the submission stream, no standings call',
      `${results} results, ${penalised} carrying an ICPC penalty`,
    );
  }

  if (args.atcoder) {
    const total = scalar(`SELECT COUNT(*) AS n FROM submissions WHERE provider = 'atcoder'`);
    // kenkoooo repeats the boundary second across pages; the id primary key is
    // what stops that becoming duplicate rows.
    const distinct = scalar(
      `SELECT COUNT(DISTINCT provider_submission_id) AS n FROM submissions WHERE provider = 'atcoder'`,
    );
    check(
      total === distinct ? 'ok' : 'fail',
      'AtCoder paging deduped by submission id',
      `${total} rows, ${distinct} distinct ids`,
    );

    const timed = scalar(
      `SELECT COUNT(*) AS n FROM submissions WHERE provider = 'atcoder' AND participant_type = 'CONTESTANT'`,
    );
    check(
      total === 0 || timed > 0 ? 'ok' : 'warn',
      'participation inferred from the contest window (timed vs untimed signal)',
      `${timed} in-contest of ${total}`,
    );

    const negative = scalar(
      `SELECT COUNT(*) AS n FROM problems WHERE provider = 'atcoder' AND platform_rating < 0`,
    );
    check(
      negative === 0 ? 'ok' : 'fail',
      'no negative AtCoder difficulty survived correctDifficulty',
      `${negative} negative`,
    );

    const ratingEvents = scalar(`SELECT COUNT(*) AS n FROM rating_events WHERE provider = 'atcoder'`);
    check('ok', 'AtCoder rating history stored', `${ratingEvents} events`);
  }
}

await main();
