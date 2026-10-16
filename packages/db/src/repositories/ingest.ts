import { and, eq, inArray, sql } from 'drizzle-orm';

import { nowEpochSeconds } from '@ascend/core';
import type {
  NormalizedContest,
  NormalizedContestResult,
  NormalizedProblem,
  NormalizedRatingEvent,
  NormalizedSubmission,
  ProviderFetchResult,
} from '@ascend/core';

import type { AscendDb } from '../client';
import {
  contestResults,
  contests,
  problems,
  problemTags,
  ratingEvents,
  submissions,
} from '../schema';

/**
 * Ingestion of a normalized provider payload into SQLite (spec §7, §62).
 *
 * Three rules shape everything here:
 *
 * 1. **One transaction.** A payload lands completely or not at all, so a crash
 *    mid-write can never leave submissions pointing at problems that were never
 *    stored.
 * 2. **Re-syncing is idempotent and never destructive.** Every write is an upsert
 *    keyed by a stable composite id. Nullable columns are merged with `coalesce`,
 *    because the same entity arrives from different endpoints with different
 *    completeness — a Gym problem carries no rating at all, and it must not erase
 *    the rating a regular Codeforces problem already has.
 * 3. **A synthesized row never overwrites a real one.** Contests and problems seen
 *    only through a submission reference are marked `isPlaceholder` by the
 *    adapters and inserted with `DO NOTHING`.
 *
 * Anything that cannot be stored without breaking referential integrity is
 * reported as a warning rather than dropped silently — that is what turns a run
 * into PARTIALLY SYNCED.
 */

/** Rows per statement. Keeps bound parameters far below SQLite's ceiling. */
const CHUNK_SIZE = 200;

export interface IngestCounts {
  contests: number;
  problems: number;
  submissions: number;
  contestResults: number;
  ratingEvents: number;
}

export interface IngestResult {
  counts: IngestCounts;
  warnings: string[];
}

function chunk<T>(items: T[], size: number = CHUNK_SIZE): T[][] {
  if (items.length <= size) return items.length === 0 ? [] : [items];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** `coalesce(excluded.<col>, <table>.<col>)` — keep what we have if the new value is null. */
function keepIfNull(table: string, column: string) {
  return sql.raw(`coalesce(excluded."${column}", "${table}"."${column}")`);
}

function fromExcluded(column: string) {
  return sql.raw(`excluded."${column}"`);
}

/** Which of `ids` already exist in a table keyed by a text `id` column. */
function existingContestIds(db: AscendDb, ids: string[]): Set<string> {
  const found = new Set<string>();
  for (const part of chunk(ids)) {
    for (const row of db.select({ id: contests.id }).from(contests).where(inArray(contests.id, part)).all()) {
      found.add(row.id);
    }
  }
  return found;
}

function existingProblemIds(db: AscendDb, ids: string[]): Set<string> {
  const found = new Set<string>();
  for (const part of chunk(ids)) {
    for (const row of db.select({ id: problems.id }).from(problems).where(inArray(problems.id, part)).all()) {
      found.add(row.id);
    }
  }
  return found;
}

function warnSkipped(kind: string, skipped: string[], reason: string): string | null {
  const first = skipped[0];
  if (first === undefined) return null;
  const suffix = skipped.length > 1 ? ` (first: ${first}, +${skipped.length - 1} more)` : ` (${first})`;
  return `${skipped.length} ${kind} skipped — ${reason}${suffix}`;
}

// ---------------------------------------------------------------------------
// Contests
// ---------------------------------------------------------------------------

function ingestContests(db: AscendDb, rows: NormalizedContest[], at: number): number {
  if (rows.length === 0) return 0;

  // Last one wins within a payload, so a real record beats a placeholder for the
  // same id regardless of the order the adapter emitted them in.
  const byId = new Map<string, NormalizedContest>();
  for (const row of rows) {
    const existing = byId.get(row.id);
    if (existing && !existing.isPlaceholder && row.isPlaceholder) continue;
    byId.set(row.id, row);
  }

  const toValues = (contest: NormalizedContest) => ({
    id: contest.id,
    provider: contest.provider,
    providerContestId: contest.providerContestId,
    name: contest.name,
    kind: contest.kind,
    phase: contest.phase,
    startAt: contest.startAt,
    durationSeconds: contest.durationSeconds,
    isIcpcStyle: contest.isIcpcStyle,
    icpcRegion: contest.icpcRegion,
    country: contest.country,
    city: contest.city,
    season: contest.season,
    url: contest.url,
    createdAt: at,
    updatedAt: at,
  });

  const real = [...byId.values()].filter((c) => c.isPlaceholder !== true);
  const placeholders = [...byId.values()].filter((c) => c.isPlaceholder === true);

  for (const part of chunk(real)) {
    db.insert(contests)
      .values(part.map(toValues))
      .onConflictDoUpdate({
        target: contests.id,
        set: {
          name: fromExcluded('name'),
          kind: fromExcluded('kind'),
          isIcpcStyle: fromExcluded('is_icpc_style'),
          // Catalogue metadata is sparse across endpoints; never trade a value
          // we already hold for a null.
          phase: keepIfNull('contests', 'phase'),
          startAt: keepIfNull('contests', 'start_at'),
          durationSeconds: keepIfNull('contests', 'duration_seconds'),
          icpcRegion: keepIfNull('contests', 'icpc_region'),
          country: keepIfNull('contests', 'country'),
          city: keepIfNull('contests', 'city'),
          season: keepIfNull('contests', 'season'),
          url: keepIfNull('contests', 'url'),
          updatedAt: at,
        },
      })
      .run();
  }

  for (const part of chunk(placeholders)) {
    db.insert(contests).values(part.map(toValues)).onConflictDoNothing().run();
  }

  return byId.size;
}

// ---------------------------------------------------------------------------
// Problems and their raw tags
// ---------------------------------------------------------------------------

function ingestProblems(
  db: AscendDb,
  rows: NormalizedProblem[],
  knownContestIds: Set<string>,
  at: number,
  warnings: string[],
): number {
  if (rows.length === 0) return 0;

  const byId = new Map<string, NormalizedProblem>();
  for (const row of rows) {
    const existing = byId.get(row.id);
    if (existing && !existing.isPlaceholder && row.isPlaceholder) continue;
    byId.set(row.id, row);
  }

  const orphaned: string[] = [];
  const toValues = (problem: NormalizedProblem) => {
    // A contest we never stored would break the foreign key. Keeping the problem
    // with no contest link is better than losing the submissions that hang off it.
    const linked = problem.contestId !== null && knownContestIds.has(problem.contestId);
    if (problem.contestId !== null && !linked) orphaned.push(problem.id);

    return {
      id: problem.id,
      provider: problem.provider,
      contestId: linked ? problem.contestId : null,
      index: problem.index,
      name: problem.name,
      platformRating: problem.platformRating,
      ratingSource: problem.ratingSource,
      ratingIsExperimental: problem.ratingIsExperimental,
      points: problem.points,
      solvedCount: problem.solvedCount,
      timeLimitMs: problem.timeLimitMs,
      memoryLimitBytes: problem.memoryLimitBytes,
      url: problem.url,
      createdAt: at,
      updatedAt: at,
    };
  };

  const real = [...byId.values()].filter((p) => p.isPlaceholder !== true);
  const placeholders = [...byId.values()].filter((p) => p.isPlaceholder === true);

  for (const part of chunk(real)) {
    db.insert(problems)
      .values(part.map(toValues))
      .onConflictDoUpdate({
        target: problems.id,
        set: {
          name: fromExcluded('name'),
          index: fromExcluded('index'),
          ratingIsExperimental: fromExcluded('rating_is_experimental'),
          // The load-bearing one: every Gym problem reports a null rating, and
          // Gym and regular Codeforces problems share this table.
          platformRating: keepIfNull('problems', 'platform_rating'),
          ratingSource: keepIfNull('problems', 'rating_source'),
          contestId: keepIfNull('problems', 'contest_id'),
          points: keepIfNull('problems', 'points'),
          solvedCount: keepIfNull('problems', 'solved_count'),
          timeLimitMs: keepIfNull('problems', 'time_limit_ms'),
          memoryLimitBytes: keepIfNull('problems', 'memory_limit_bytes'),
          url: keepIfNull('problems', 'url'),
          updatedAt: at,
        },
      })
      .run();
  }

  for (const part of chunk(placeholders)) {
    db.insert(problems).values(part.map(toValues)).onConflictDoNothing().run();
  }

  ingestTags(db, [...byId.values()]);

  const warning = warnSkipped(
    'problem contest link(s)',
    orphaned,
    'the referenced contest is not in this payload or the database',
  );
  if (warning) warnings.push(warning);

  return byId.size;
}

/**
 * Replaces a problem's tags — but only when the payload actually has some.
 *
 * Gym and AtCoder publish no tags at all, so an empty list means "this source
 * does not know", not "this problem has no tags". Treating the two the same would
 * let a Gym sync wipe the tags a regular Codeforces sync had already stored.
 */
function ingestTags(db: AscendDb, rows: NormalizedProblem[]): void {
  const tagged = rows.filter((problem) => problem.tags.length > 0);
  if (tagged.length === 0) return;

  for (const part of chunk(tagged.map((problem) => problem.id))) {
    db.delete(problemTags).where(inArray(problemTags.problemId, part)).run();
  }

  const pairs = tagged.flatMap((problem) =>
    [...new Set(problem.tags)].map((tag) => ({ problemId: problem.id, tag })),
  );
  for (const part of chunk(pairs, 400)) {
    db.insert(problemTags).values(part).onConflictDoNothing().run();
  }
}

// ---------------------------------------------------------------------------
// Submissions
// ---------------------------------------------------------------------------

function ingestSubmissions(
  db: AscendDb,
  rows: NormalizedSubmission[],
  knownContestIds: Set<string>,
  knownProblemIds: Set<string>,
  at: number,
  warnings: string[],
): number {
  if (rows.length === 0) return 0;

  const byId = new Map<string, NormalizedSubmission>();
  for (const row of rows) byId.set(row.id, row);

  const missingProblem: string[] = [];
  const values: (typeof submissions.$inferInsert)[] = [];

  for (const submission of byId.values()) {
    // `problem_id` is NOT NULL, so without the problem there is nowhere to put
    // this row. Reporting it is the only honest option.
    if (!knownProblemIds.has(submission.problemId)) {
      missingProblem.push(submission.id);
      continue;
    }

    values.push({
      id: submission.id,
      provider: submission.provider,
      providerSubmissionId: submission.providerSubmissionId,
      problemId: submission.problemId,
      contestId:
        submission.contestId !== null && knownContestIds.has(submission.contestId)
          ? submission.contestId
          : null,
      verdict: submission.verdict,
      language: submission.language,
      submittedAt: submission.submittedAt,
      relativeTimeSeconds: submission.relativeTimeSeconds,
      participantType: submission.participantType,
      timeConsumedMs: submission.timeConsumedMs,
      memoryConsumedBytes: submission.memoryConsumedBytes,
      passedTestCount: submission.passedTestCount,
      ingestedAt: at,
    });
  }

  for (const part of chunk(values)) {
    db.insert(submissions)
      .values(part)
      .onConflictDoUpdate({
        target: submissions.id,
        set: {
          // A submission re-synced while judging moves TESTING → a real verdict,
          // so the mutable fields are taken from the new row. `ingested_at`
          // deliberately is not: it records when Ascend first saw it.
          verdict: fromExcluded('verdict'),
          language: keepIfNull('submissions', 'language'),
          relativeTimeSeconds: keepIfNull('submissions', 'relative_time_seconds'),
          participantType: keepIfNull('submissions', 'participant_type'),
          timeConsumedMs: keepIfNull('submissions', 'time_consumed_ms'),
          memoryConsumedBytes: keepIfNull('submissions', 'memory_consumed_bytes'),
          passedTestCount: keepIfNull('submissions', 'passed_test_count'),
          contestId: keepIfNull('submissions', 'contest_id'),
        },
      })
      .run();
  }

  const warning = warnSkipped(
    'submission(s)',
    missingProblem,
    'their problem is not in this payload or the database',
  );
  if (warning) warnings.push(warning);

  return values.length;
}

// ---------------------------------------------------------------------------
// Contest results
// ---------------------------------------------------------------------------

/**
 * Replaces the user's result rows for each `(contest, participation)` pair.
 *
 * Delete-then-insert rather than an upsert because the unique index includes the
 * nullable `started_at`, and SQLite treats NULLs as distinct — an upsert would
 * quietly accumulate duplicate rows for any contest whose start time is unknown.
 * The caller derives these from the *complete* stored submission set, so the
 * incoming rows are authoritative for those pairs.
 */
function ingestContestResults(
  db: AscendDb,
  rows: NormalizedContestResult[],
  knownContestIds: Set<string>,
  at: number,
  warnings: string[],
): number {
  if (rows.length === 0) return 0;

  const orphaned: string[] = [];
  const kept = rows.filter((row) => {
    if (knownContestIds.has(row.contestId)) return true;
    orphaned.push(row.contestId);
    return false;
  });

  const pairs = new Map<string, { contestId: string; participantType: string }>();
  for (const row of kept) {
    pairs.set(`${row.contestId}|${row.participantType}`, {
      contestId: row.contestId,
      participantType: row.participantType,
    });
  }

  for (const pair of pairs.values()) {
    db.delete(contestResults)
      .where(
        and(
          eq(contestResults.contestId, pair.contestId),
          eq(contestResults.participantType, pair.participantType),
        ),
      )
      .run();
  }

  for (const part of chunk(kept)) {
    db.insert(contestResults)
      .values(
        part.map((row) => ({
          contestId: row.contestId,
          participantType: row.participantType,
          rank: row.rank,
          points: row.points,
          penalty: row.penalty,
          solvedCount: row.solvedCount,
          problemCount: row.problemCount,
          ratingBefore: row.ratingBefore,
          ratingAfter: row.ratingAfter,
          performance: row.performance,
          isRated: row.isRated,
          startedAt: row.startedAt,
          createdAt: at,
          updatedAt: at,
        })),
      )
      .run();
  }

  const warning = warnSkipped(
    'contest result(s)',
    orphaned,
    'the contest is not in this payload or the database',
  );
  if (warning) warnings.push(warning);

  return kept.length;
}

// ---------------------------------------------------------------------------
// Rating events
// ---------------------------------------------------------------------------

function ingestRatingEvents(
  db: AscendDb,
  rows: NormalizedRatingEvent[],
  knownContestIds: Set<string>,
  warnings: string[],
): number {
  if (rows.length === 0) return 0;

  const orphaned: string[] = [];
  let written = 0;

  for (const event of rows) {
    const linked = event.contestId !== null && knownContestIds.has(event.contestId);
    if (event.contestId !== null && !linked) {
      orphaned.push(event.contestId);
      continue;
    }

    const values = {
      provider: event.provider,
      contestId: linked ? event.contestId : null,
      contestName: event.contestName,
      rank: event.rank,
      ratingBefore: event.ratingBefore,
      ratingAfter: event.ratingAfter,
      performance: event.performance,
      at: event.at,
    };

    if (values.contestId === null) {
      // The unique index cannot dedupe a null contest id, so identity falls back
      // to the provider plus the moment the event happened.
      const existing = db
        .select({ id: ratingEvents.id })
        .from(ratingEvents)
        .where(and(eq(ratingEvents.provider, event.provider), eq(ratingEvents.at, event.at)))
        .get();
      if (existing) continue;
      db.insert(ratingEvents).values(values).run();
      written += 1;
      continue;
    }

    db.insert(ratingEvents)
      .values(values)
      .onConflictDoUpdate({
        target: [ratingEvents.provider, ratingEvents.contestId],
        set: {
          contestName: keepIfNull('rating_events', 'contest_name'),
          rank: keepIfNull('rating_events', 'rank'),
          ratingBefore: keepIfNull('rating_events', 'rating_before'),
          ratingAfter: keepIfNull('rating_events', 'rating_after'),
          performance: keepIfNull('rating_events', 'performance'),
          at: fromExcluded('at'),
        },
      })
      .run();
    written += 1;
  }

  const warning = warnSkipped(
    'rating event(s)',
    orphaned,
    'the contest is not in this payload or the database',
  );
  if (warning) warnings.push(warning);

  return written;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Writes one adapter's payload to the database in a single transaction.
 *
 * Order is dictated by the foreign keys: contests, then problems, then
 * submissions, then the rows that reference contests.
 */
export function ingestFetchResult(db: AscendDb, result: ProviderFetchResult): IngestResult {
  const at = nowEpochSeconds();
  const warnings: string[] = [];

  const counts = db.transaction((tx): IngestCounts => {
    const contestCount = ingestContests(tx, result.contests, at);

    // Anything referenced but not carried in this payload may still be in the
    // database from an earlier run, so referential checks consult both.
    const referencedContestIds = new Set<string>();
    for (const contest of result.contests) referencedContestIds.add(contest.id);
    const knownContestIds = new Set(referencedContestIds);
    const lookupContests = [
      ...new Set(
        [
          ...result.problems.map((p) => p.contestId),
          ...result.submissions.map((s) => s.contestId),
          ...result.contestResults.map((r) => r.contestId),
          ...result.ratingEvents.map((e) => e.contestId),
        ].filter((id): id is string => id !== null && !referencedContestIds.has(id)),
      ),
    ];
    for (const id of existingContestIds(tx, lookupContests)) knownContestIds.add(id);

    const problemCount = ingestProblems(tx, result.problems, knownContestIds, at, warnings);

    const knownProblemIds = new Set(result.problems.map((problem) => problem.id));
    const lookupProblems = [
      ...new Set(
        result.submissions
          .map((submission) => submission.problemId)
          .filter((id) => !knownProblemIds.has(id)),
      ),
    ];
    for (const id of existingProblemIds(tx, lookupProblems)) knownProblemIds.add(id);

    const submissionCount = ingestSubmissions(
      tx,
      result.submissions,
      knownContestIds,
      knownProblemIds,
      at,
      warnings,
    );
    const resultCount = ingestContestResults(
      tx,
      result.contestResults,
      knownContestIds,
      at,
      warnings,
    );
    const ratingCount = ingestRatingEvents(tx, result.ratingEvents, knownContestIds, warnings);

    return {
      contests: contestCount,
      problems: problemCount,
      submissions: submissionCount,
      contestResults: resultCount,
      ratingEvents: ratingCount,
    };
  });

  return { counts, warnings };
}

/**
 * Every stored submission for the given contests, shaped for re-derivation.
 *
 * The sync engine uses this to recompute contest results from the *complete*
 * history rather than from whichever submissions happened to arrive in the last
 * incremental page — a contest straddling the cursor boundary would otherwise be
 * scored from half its submissions.
 */
export function listSubmissionsForContests(
  db: AscendDb,
  contestIds: string[],
): NormalizedSubmission[] {
  const out: NormalizedSubmission[] = [];
  for (const part of chunk([...new Set(contestIds)])) {
    out.push(
      ...db
        .select({
          id: submissions.id,
          provider: submissions.provider,
          providerSubmissionId: submissions.providerSubmissionId,
          problemId: submissions.problemId,
          contestId: submissions.contestId,
          verdict: submissions.verdict,
          language: submissions.language,
          submittedAt: submissions.submittedAt,
          relativeTimeSeconds: submissions.relativeTimeSeconds,
          participantType: submissions.participantType,
          timeConsumedMs: submissions.timeConsumedMs,
          memoryConsumedBytes: submissions.memoryConsumedBytes,
          passedTestCount: submissions.passedTestCount,
        })
        .from(submissions)
        .where(inArray(submissions.contestId, part))
        .all(),
    );
  }
  return out;
}

/**
 * Stored contest metadata for the given ids.
 *
 * Re-derivation reads this rather than the payload it just ingested, because a
 * contest's start time may have arrived in an earlier sync and an incremental
 * payload carries only what changed.
 */
export function listContestsByIds(db: AscendDb, contestIds: string[]): NormalizedContest[] {
  const out: NormalizedContest[] = [];
  for (const part of chunk([...new Set(contestIds)])) {
    out.push(
      ...db
        .select({
          id: contests.id,
          provider: contests.provider,
          providerContestId: contests.providerContestId,
          name: contests.name,
          kind: contests.kind,
          phase: contests.phase,
          startAt: contests.startAt,
          durationSeconds: contests.durationSeconds,
          isIcpcStyle: contests.isIcpcStyle,
          icpcRegion: contests.icpcRegion,
          country: contests.country,
          city: contests.city,
          season: contests.season,
          url: contests.url,
        })
        .from(contests)
        .where(inArray(contests.id, part))
        .all(),
    );
  }
  return out;
}

/** Stored rating events for the given contests, for rank and rating deltas. */
export function listRatingEventsForContests(
  db: AscendDb,
  contestIds: string[],
): NormalizedRatingEvent[] {
  const out: NormalizedRatingEvent[] = [];
  for (const part of chunk([...new Set(contestIds)])) {
    out.push(
      ...db
        .select({
          provider: ratingEvents.provider,
          contestId: ratingEvents.contestId,
          contestName: ratingEvents.contestName,
          rank: ratingEvents.rank,
          ratingBefore: ratingEvents.ratingBefore,
          ratingAfter: ratingEvents.ratingAfter,
          performance: ratingEvents.performance,
          at: ratingEvents.at,
        })
        .from(ratingEvents)
        .where(inArray(ratingEvents.contestId, part))
        .all(),
    );
  }
  return out;
}
