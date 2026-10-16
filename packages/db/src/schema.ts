import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
  type AnySQLiteColumn,
} from 'drizzle-orm/sqlite-core';

import {
  ATTEMPT_PHASES,
  HELP_LEVELS,
  MASTERY_STATES,
  PREPARATION_PHASES,
  PRIORITY_CLASSES,
  PROVIDERS,
  READINESS_DIMENSIONS,
  SESSION_TYPES,
  TRAINING_MODES,
  TRAINING_OBJECTIVES,
} from '@ascend/core';
import type {
  AbandonReason,
  AttemptPhase,
  DimensionScore,
  EvidenceItem,
  ReadinessDimension,
  SyncCursor,
} from '@ascend/core';

/**
 * Ascend's SQLite schema (spec §49).
 *
 * Conventions
 * -----------
 * - All timestamps are Unix epoch **seconds** in `*_at` integer columns, which
 *   matches what Codeforces and AtCoder return and avoids timezone ambiguity.
 * - Calendar dates the user reasons about (target date, training day) are
 *   `YYYY-MM-DD` text, because "which day" is a wall-clock question.
 * - Externally-sourced rows use stable composite ids (`cf:1846:E2`) so that
 *   re-syncing is idempotent — see `@ascend/core/ids`.
 * - Both raw provider payloads and normalized entities are stored (§7), so a
 *   parsing bug can be diagnosed and replayed without re-hitting the network.
 */

const providerEnum = { enum: PROVIDERS } as const;

// ===========================================================================
// Identity and configuration
// ===========================================================================

/** Key/value application settings (§64), including engine weights (§27, §37). */
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value', { mode: 'json' }).$type<unknown>().notNull(),
  updatedAt: integer('updated_at').notNull(),
});

/** Single-user profile. Exactly one row, `id = 1`. */
export const userProfile = sqliteTable('user_profile', {
  id: integer('id').primaryKey(),
  displayName: text('display_name'),
  /** Optional local team info (§34). Team sync is explicitly out of scope for V1. */
  teamName: text('team_name'),
  onboardedAt: integer('onboarded_at'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

/** Team members, local-only (§34). Kept minimal so V1 needs no multi-user infra. */
export const teamMembers = sqliteTable('team_members', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  codeforcesHandle: text('codeforces_handle'),
  atcoderHandle: text('atcoder_handle'),
  strengths: text('strengths'),
  weaknesses: text('weaknesses'),
  createdAt: integer('created_at').notNull(),
});

/** One row per synchronized platform identity (§1). */
export const platformAccounts = sqliteTable(
  'platform_accounts',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    provider: text('provider', providerEnum).notNull(),
    handle: text('handle').notNull(),
    /** Set once the handle has been confirmed to exist on the platform. */
    verifiedAt: integer('verified_at'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [uniqueIndex('platform_accounts_provider_unique').on(table.provider)],
);

/**
 * The target Regional (§3). The user must configure this — the app never
 * invents a contest date. Exactly one row is active at a time.
 */
export const targetEvents = sqliteTable(
  'target_events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
    /** `YYYY-MM-DD`. */
    date: text('date').notNull(),
    location: text('location'),
    notes: text('notes'),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(false),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [index('target_events_active_idx').on(table.isActive)],
);

/** Training time budget per weekday (§53). Seven rows, `weekday` 0 = Sunday. */
export const availability = sqliteTable('availability', {
  weekday: integer('weekday').primaryKey(),
  minutes: integer('minutes').notNull().default(0),
  updatedAt: integer('updated_at').notNull(),
});

// ===========================================================================
// Raw provider data (§7 — "the database should store both")
// ===========================================================================

export const rawPayloads = sqliteTable(
  'raw_payloads',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    provider: text('provider', providerEnum).notNull(),
    /** Logical source, e.g. `user.status` or `gym/104555/my`. */
    endpoint: text('endpoint').notNull(),
    /** Distinguishes calls to the same endpoint, e.g. `handle=x&from=1`. */
    requestKey: text('request_key').notNull().default(''),
    httpStatus: integer('http_status'),
    fetchedAt: integer('fetched_at').notNull(),
    /** Raw response, stored verbatim for replay and debugging. */
    body: text('body').notNull(),
    /** Size of the response as received, even when the body was not kept. */
    bodyBytes: integer('body_bytes').notNull().default(0),
    /**
     * 1 when the response exceeded the storage cap and `body` is empty. A
     * truncated body would not replay, so an oversized payload is recorded as
     * absent rather than stored in part (§58).
     */
    bodyOmitted: integer('body_omitted', { mode: 'boolean' }).notNull().default(false),
  },
  (table) => [
    uniqueIndex('raw_payloads_request_unique').on(
      table.provider,
      table.endpoint,
      table.requestKey,
    ),
  ],
);

// ===========================================================================
// Normalized platform data (§6, §7)
// ===========================================================================

export const contests = sqliteTable(
  'contests',
  {
    /** Composite id, e.g. `cf:1846`, `gym:104555`, `ac:abc300`. */
    id: text('id').primaryKey(),
    provider: text('provider', providerEnum).notNull(),
    /** The provider's own identifier, unprefixed. */
    providerContestId: text('provider_contest_id').notNull(),
    name: text('name').notNull(),
    kind: text('kind', { enum: ['regular', 'gym', 'atcoder'] }).notNull(),
    /** Provider-reported phase, e.g. FINISHED / BEFORE. */
    phase: text('phase'),
    startAt: integer('start_at'),
    durationSeconds: integer('duration_seconds'),
    /**
     * True for ICPC-style sets (§6B, §37). Derived from Codeforces Gym metadata
     * such as `kind: "Official ICPC Contest"` and the presence of an ICPC region.
     */
    isIcpcStyle: integer('is_icpc_style', { mode: 'boolean' }).notNull().default(false),
    icpcRegion: text('icpc_region'),
    country: text('country'),
    city: text('city'),
    season: text('season'),
    url: text('url'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    index('contests_provider_idx').on(table.provider),
    index('contests_start_idx').on(table.startAt),
    index('contests_icpc_idx').on(table.isIcpcStyle),
  ],
);

/** The user's own result in a contest (§6, §19). */
export const contestResults = sqliteTable(
  'contest_results',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    contestId: text('contest_id')
      .notNull()
      .references(() => contests.id, { onDelete: 'cascade' }),
    participantType: text('participant_type').notNull(),
    rank: integer('rank'),
    points: real('points'),
    penalty: integer('penalty'),
    solvedCount: integer('solved_count'),
    problemCount: integer('problem_count'),
    ratingBefore: integer('rating_before'),
    ratingAfter: integer('rating_after'),
    /** AtCoder reports a per-contest performance value distinct from rating. */
    performance: integer('performance'),
    isRated: integer('is_rated', { mode: 'boolean' }).notNull().default(false),
    /** Virtual/practice participation is not contest pressure in the same way. */
    startedAt: integer('started_at'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('contest_results_unique').on(
      table.contestId,
      table.participantType,
      table.startedAt,
    ),
  ],
);

export const problems = sqliteTable(
  'problems',
  {
    /** Composite id, e.g. `cf:1846:E2`, `gym:104555:A`, `ac:abc300_d`. */
    id: text('id').primaryKey(),
    provider: text('provider', providerEnum).notNull(),
    contestId: text('contest_id').references(() => contests.id, { onDelete: 'set null' }),
    /** Position within the contest, e.g. `E2` or the AtCoder task slug. */
    index: text('index').notNull(),
    name: text('name').notNull(),
    /**
     * Platform-reported difficulty. **Nullable on purpose**: Gym problems have
     * no rating, so "unknown" is a first-class case for the difficulty model (§17).
     */
    platformRating: integer('platform_rating'),
    /** Where `platformRating` came from: `codeforces`, `atcoder_estimate`, or null. */
    ratingSource: text('rating_source'),
    /** AtCoder difficulty estimates are flagged experimental by the source. */
    ratingIsExperimental: integer('rating_is_experimental', { mode: 'boolean' })
      .notNull()
      .default(false),
    points: real('points'),
    solvedCount: integer('solved_count'),
    timeLimitMs: integer('time_limit_ms'),
    memoryLimitBytes: integer('memory_limit_bytes'),
    url: text('url'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    index('problems_provider_idx').on(table.provider),
    index('problems_contest_idx').on(table.contestId),
    index('problems_rating_idx').on(table.platformRating),
  ],
);

/** Raw provider tags, kept separate from Ascend's own taxonomy (§10). */
export const problemTags = sqliteTable(
  'problem_tags',
  {
    problemId: text('problem_id')
      .notNull()
      .references(() => problems.id, { onDelete: 'cascade' }),
    tag: text('tag').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.problemId, table.tag] }),
    index('problem_tags_tag_idx').on(table.tag),
  ],
);

export const submissions = sqliteTable(
  'submissions',
  {
    /** Composite id, e.g. `cf:245871003`. */
    id: text('id').primaryKey(),
    provider: text('provider', providerEnum).notNull(),
    providerSubmissionId: text('provider_submission_id').notNull(),
    problemId: text('problem_id')
      .notNull()
      .references(() => problems.id, { onDelete: 'cascade' }),
    contestId: text('contest_id').references(() => contests.id, { onDelete: 'set null' }),
    verdict: text('verdict').notNull(),
    language: text('language'),
    /** Provider timestamp (epoch seconds). */
    submittedAt: integer('submitted_at').notNull(),
    /** Seconds into the contest; only present for in-contest submissions (§9). */
    relativeTimeSeconds: integer('relative_time_seconds'),
    /** CONTESTANT / PRACTICE / VIRTUAL — how timed vs untimed work is told apart. */
    participantType: text('participant_type'),
    timeConsumedMs: integer('time_consumed_ms'),
    memoryConsumedBytes: integer('memory_consumed_bytes'),
    passedTestCount: integer('passed_test_count'),
    /** When Ascend first stored this row. */
    ingestedAt: integer('ingested_at').notNull(),
  },
  (table) => [
    index('submissions_problem_idx').on(table.problemId),
    index('submissions_contest_idx').on(table.contestId),
    index('submissions_submitted_idx').on(table.submittedAt),
    index('submissions_verdict_idx').on(table.verdict),
  ],
);

/**
 * Submission source code (§21). Separate table because source is fetched by
 * scraping rather than the API, is comparatively large, and is optional.
 */
export const submissionSources = sqliteTable('submission_sources', {
  submissionId: text('submission_id')
    .primaryKey()
    .references(() => submissions.id, { onDelete: 'cascade' }),
  code: text('code').notNull(),
  byteLength: integer('byte_length').notNull(),
  fetchedAt: integer('fetched_at').notNull(),
});

/** Rating history (§6). Useful evidence, explicitly not the goal (§48). */
export const ratingEvents = sqliteTable(
  'rating_events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    provider: text('provider', providerEnum).notNull(),
    contestId: text('contest_id').references(() => contests.id, { onDelete: 'cascade' }),
    contestName: text('contest_name'),
    rank: integer('rank'),
    ratingBefore: integer('rating_before'),
    ratingAfter: integer('rating_after'),
    performance: integer('performance'),
    at: integer('at').notNull(),
  },
  (table) => [uniqueIndex('rating_events_unique').on(table.provider, table.contestId)],
);

// ===========================================================================
// Topic taxonomy and mastery (§10, §13, §23)
// ===========================================================================

export const topicNodes = sqliteTable(
  'topic_nodes',
  {
    /** Stable slug, e.g. `graphs.shortest_path.dijkstra`. */
    id: text('id').primaryKey(),
    parentId: text('parent_id').references((): AnySQLiteColumn => topicNodes.id, {
      onDelete: 'cascade',
    }),
    name: text('name').notNull(),
    /** Depth in the tree, 0 for roots. */
    depth: integer('depth').notNull().default(0),
    /** 0..1 — how much this matters for ICPC specifically (§11). */
    icpcRelevance: real('icpc_relevance').notNull().default(0.5),
    priorityClass: text('priority_class', { enum: PRIORITY_CLASSES }).notNull(),
    /** Topic ids that should be comfortable before this one is introduced. */
    prerequisites: text('prerequisites', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    /** Typical difficulty band where this technique starts appearing. */
    typicalRatingFloor: integer('typical_rating_floor'),
    sortOrder: integer('sort_order').notNull().default(0),
    description: text('description'),
  },
  (table) => [
    index('topic_nodes_parent_idx').on(table.parentId),
    index('topic_nodes_priority_idx').on(table.priorityClass),
  ],
);

/**
 * Problem → topic mapping (§10). `source` records how the mapping was made,
 * because tag rules are reliable but coarse while LLM classification reaches
 * subtopics at lower confidence (§7 of the plan's gap analysis).
 */
export const problemTopics = sqliteTable(
  'problem_topics',
  {
    problemId: text('problem_id')
      .notNull()
      .references(() => problems.id, { onDelete: 'cascade' }),
    topicId: text('topic_id')
      .notNull()
      .references(() => topicNodes.id, { onDelete: 'cascade' }),
    /** 0..1. Tag rules score high; LLM inference carries its own confidence. */
    confidence: real('confidence').notNull(),
    source: text('source', { enum: ['tag_rule', 'llm', 'manual'] }).notNull(),
    /** Model and prompt version, so a reclassification pass can be targeted (§59). */
    model: text('model'),
    promptVersion: text('prompt_version'),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.problemId, table.topicId] }),
    index('problem_topics_topic_idx').on(table.topicId),
  ],
);

/** Per-topic knowledge state and spaced-repetition schedule (§13, §23). */
export const topicMastery = sqliteTable(
  'topic_mastery',
  {
    topicId: text('topic_id')
      .primaryKey()
      .references(() => topicNodes.id, { onDelete: 'cascade' }),
    state: text('state', { enum: MASTERY_STATES }).notNull(),
    /** 0..100, matching how the learning log displays it. */
    mastery: real('mastery').notNull().default(0),
    /** 0..1 confidence in `mastery`, driven by how much evidence exists. */
    confidence: real('confidence').notNull().default(0),
    evidenceCount: integer('evidence_count').notNull().default(0),
    solvedCount: integer('solved_count').notNull().default(0),
    failedCount: integer('failed_count').notNull().default(0),
    /** Solves that happened under contest pressure — the strongest evidence. */
    contestProvenCount: integer('contest_proven_count').notNull().default(0),
    lastPracticedAt: integer('last_practiced_at'),
    lastFailedAt: integer('last_failed_at'),
    /** Spaced repetition (§13). */
    nextReviewAt: integer('next_review_at'),
    intervalDays: real('interval_days').notNull().default(0),
    ease: real('ease').notNull().default(2.5),
    /** 0..1 estimated probability the technique has decayed. */
    forgettingRisk: real('forgetting_risk').notNull().default(0),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    index('topic_mastery_review_idx').on(table.nextReviewAt),
    index('topic_mastery_state_idx').on(table.state),
  ],
);

/** Free-form user notes per topic (§23 "allow manual notes"). */
export const learningLogNotes = sqliteTable(
  'learning_log_notes',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    topicId: text('topic_id')
      .notNull()
      .references(() => topicNodes.id, { onDelete: 'cascade' }),
    note: text('note').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [index('learning_log_notes_topic_idx').on(table.topicId)],
);

// ===========================================================================
// Assessment: readiness and weaknesses (§5, §12, §27)
// ===========================================================================

/** Daily readiness snapshot, which is what makes trends possible (§28, §32). */
export const readinessSnapshots = sqliteTable(
  'readiness_snapshots',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    /** `YYYY-MM-DD` — at most one snapshot per day. */
    date: text('date').notNull(),
    /** 0..1, or null when the evidence is too thin to report a number (§58). */
    overall: real('overall'),
    dimensions: text('dimensions', { mode: 'json' })
      .$type<Record<ReadinessDimension, DimensionScore>>()
      .notNull(),
    /** The computed inputs, retained so a past score can be explained (§36). */
    evidence: text('evidence', { mode: 'json' }).$type<Record<string, unknown>>(),
    phase: text('phase', { enum: PREPARATION_PHASES }),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [uniqueIndex('readiness_snapshots_date_unique').on(table.date)],
);

/**
 * A detected weakness (§12). `why` and `evidence` are mandatory because the
 * spec requires the assistant to explain why it believes a weakness exists.
 */
export const weaknesses = sqliteTable(
  'weaknesses',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    /** Detector identity, e.g. `high_attempts_to_ac`, `timed_vs_untimed_gap`. */
    kind: text('kind').notNull(),
    topicId: text('topic_id').references(() => topicNodes.id, { onDelete: 'set null' }),
    dimension: text('dimension', { enum: READINESS_DIMENSIONS }),
    title: text('title').notNull(),
    /** 0..1. */
    severity: real('severity').notNull(),
    /** 0..1. */
    confidence: real('confidence').notNull(),
    why: text('why').notNull(),
    evidence: text('evidence', { mode: 'json' }).$type<EvidenceItem[]>().notNull(),
    detectedAt: integer('detected_at').notNull(),
    lastSeenAt: integer('last_seen_at').notNull(),
    resolvedAt: integer('resolved_at'),
  },
  (table) => [
    index('weaknesses_kind_idx').on(table.kind),
    index('weaknesses_topic_idx').on(table.topicId),
    index('weaknesses_open_idx').on(table.resolvedAt),
  ],
);

// ===========================================================================
// Training (§14, §39, §53) and instrumented attempts (§12, §20, §26)
// ===========================================================================

export const trainingSessions = sqliteTable(
  'training_sessions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    /** `YYYY-MM-DD` the session is planned for. */
    date: text('date').notNull(),
    mode: text('mode', { enum: TRAINING_MODES }).notNull(),
    type: text('type', { enum: SESSION_TYPES }).notNull(),
    objective: text('objective', { enum: TRAINING_OBJECTIVES }).notNull(),
    /** Prose statement of the goal, shown as "TODAY'S MISSION". */
    mission: text('mission').notNull(),
    plannedMinutes: integer('planned_minutes').notNull(),
    actualMinutes: integer('actual_minutes'),
    status: text('status', {
      enum: ['planned', 'in_progress', 'completed', 'skipped', 'partial'],
    })
      .notNull()
      .default('planned'),
    /** Why a planned session was skipped (§52) — asked, never assumed. */
    skipReason: text('skip_reason'),
    /** The routing decision and its evidence, for the "WHY?" panel (§15, §46). */
    rationale: text('rationale', { mode: 'json' }).$type<{
      reasons: string[];
      evidence: EvidenceItem[];
    }>(),
    phase: text('phase', { enum: PREPARATION_PHASES }),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    completedAt: integer('completed_at'),
  },
  (table) => [
    index('training_sessions_date_idx').on(table.date),
    index('training_sessions_status_idx').on(table.status),
  ],
);

export const trainingSessionItems = sqliteTable(
  'training_session_items',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    sessionId: integer('session_id')
      .notNull()
      .references(() => trainingSessions.id, { onDelete: 'cascade' }),
    sortOrder: integer('sort_order').notNull().default(0),
    kind: text('kind', {
      enum: ['review', 'learn', 'practice', 'deep_practice', 'simulation', 'reflection'],
    }).notNull(),
    /** Prose instruction, e.g. "Review: Binary Search on Answer". */
    label: text('label').notNull(),
    problemId: text('problem_id').references(() => problems.id, { onDelete: 'set null' }),
    topicId: text('topic_id').references(() => topicNodes.id, { onDelete: 'set null' }),
    plannedMinutes: integer('planned_minutes').notNull(),
    status: text('status', { enum: ['planned', 'in_progress', 'done', 'skipped'] })
      .notNull()
      .default('planned'),
    outcome: text('outcome'),
    notes: text('notes'),
    /** Why this specific item was chosen (§16 — never a random problem). */
    reason: text('reason'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [index('training_session_items_session_idx').on(table.sessionId)],
);

/**
 * One instrumented attempt at one problem.
 *
 * This table exists because the signals §12 and §20 ask for — time before
 * abandoning, debugging time, whether a problem was read and dropped — leave no
 * trace on any platform. They are only observable if Ascend times the work itself.
 */
export const problemAttempts = sqliteTable(
  'problem_attempts',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    problemId: text('problem_id')
      .notNull()
      .references(() => problems.id, { onDelete: 'cascade' }),
    sessionItemId: integer('session_item_id').references(() => trainingSessionItems.id, {
      onDelete: 'set null',
    }),
    simulationId: integer('simulation_id').references((): AnySQLiteColumn => simulations.id, {
      onDelete: 'set null',
    }),
    startedAt: integer('started_at').notNull(),
    endedAt: integer('ended_at'),
    /** Which phase the timer is currently in. */
    activePhase: text('active_phase', { enum: ATTEMPT_PHASES }),
    /** Seconds accumulated per phase. */
    phaseTimings: text('phase_timings', { mode: 'json' })
      .$type<Partial<Record<AttemptPhase, number>>>()
      .notNull()
      .default(sql`'{}'`),
    outcome: text('outcome', {
      enum: ['in_progress', 'solved', 'abandoned', 'unfinished'],
    })
      .notNull()
      .default('in_progress'),
    /** Strongest help used (§26). A solve after `full` is not an independent solve. */
    helpLevel: text('help_level', { enum: HELP_LEVELS }).notNull().default('none'),
    abandonReason: text('abandon_reason').$type<AbandonReason>(),
    firstSubmitAt: integer('first_submit_at'),
    acceptedAt: integer('accepted_at'),
    submissionCount: integer('submission_count').notNull().default(0),
    /** The user's own difficulty impression, 1-5, for calibrating §17. */
    perceivedDifficulty: integer('perceived_difficulty'),
    notes: text('notes'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    index('problem_attempts_problem_idx').on(table.problemId),
    index('problem_attempts_started_idx').on(table.startedAt),
    index('problem_attempts_outcome_idx').on(table.outcome),
  ],
);

/** Progressive hint escalation (§26), recorded so help never goes unaccounted. */
export const hintEvents = sqliteTable(
  'hint_events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    attemptId: integer('attempt_id')
      .notNull()
      .references(() => problemAttempts.id, { onDelete: 'cascade' }),
    level: text('level', { enum: HELP_LEVELS }).notNull(),
    content: text('content'),
    llmCallId: integer('llm_call_id').references((): AnySQLiteColumn => llmCalls.id, {
      onDelete: 'set null',
    }),
    at: integer('at').notNull(),
  },
  (table) => [index('hint_events_attempt_idx').on(table.attemptId)],
);

// ===========================================================================
// Contest simulation (§18, §40)
// ===========================================================================

export const simulations = sqliteTable(
  'simulations',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    kind: text('kind', { enum: ['mini', 'medium', 'full'] }).notNull(),
    title: text('title').notNull(),
    /** Set when the set came from a real contest, typically a Gym ICPC set (§37). */
    contestId: text('contest_id').references(() => contests.id, { onDelete: 'set null' }),
    durationMinutes: integer('duration_minutes').notNull(),
    objective: text('objective', { enum: TRAINING_OBJECTIVES }).notNull(),
    /** Ordered problem ids chosen for the set. */
    problemSet: text('problem_set', { mode: 'json' }).$type<string[]>().notNull(),
    startedAt: integer('started_at'),
    endedAt: integer('ended_at'),
    status: text('status', { enum: ['planned', 'running', 'finished', 'abandoned'] })
      .notNull()
      .default('planned'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [index('simulations_status_idx').on(table.status)],
);

/** Timeline of a simulation, which is what the post-contest report reads (§19). */
export const simulationEvents = sqliteTable(
  'simulation_events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    simulationId: integer('simulation_id')
      .notNull()
      .references(() => simulations.id, { onDelete: 'cascade' }),
    at: integer('at').notNull(),
    type: text('type').notNull(),
    problemId: text('problem_id').references(() => problems.id, { onDelete: 'set null' }),
    payload: text('payload', { mode: 'json' }).$type<Record<string, unknown>>(),
  },
  (table) => [index('simulation_events_sim_idx').on(table.simulationId)],
);

// ===========================================================================
// Mistake journal (§22) and reviews (§31, §32)
// ===========================================================================

export const mistakes = sqliteTable(
  'mistakes',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    category: text('category').notNull(),
    topicId: text('topic_id').references(() => topicNodes.id, { onDelete: 'set null' }),
    /** Short label, e.g. "Incorrect monotonic condition". */
    title: text('title').notNull(),
    cause: text('cause'),
    /** The lesson, e.g. "Define the feasibility predicate first." */
    lesson: text('lesson'),
    /** Denormalized count of occurrences, for "you did this 4 times" (§22). */
    repetitionCount: integer('repetition_count').notNull().default(0),
    firstSeenAt: integer('first_seen_at').notNull(),
    lastSeenAt: integer('last_seen_at').notNull(),
    status: text('status', { enum: ['open', 'improving', 'resolved'] })
      .notNull()
      .default('open'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    index('mistakes_category_idx').on(table.category),
    index('mistakes_status_idx').on(table.status),
  ],
);

export const mistakeOccurrences = sqliteTable(
  'mistake_occurrences',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    mistakeId: integer('mistake_id')
      .notNull()
      .references(() => mistakes.id, { onDelete: 'cascade' }),
    problemId: text('problem_id').references(() => problems.id, { onDelete: 'set null' }),
    submissionId: text('submission_id').references(() => submissions.id, {
      onDelete: 'set null',
    }),
    at: integer('at').notNull(),
    notes: text('notes'),
  },
  (table) => [index('mistake_occurrences_mistake_idx').on(table.mistakeId)],
);

export const reviews = sqliteTable(
  'reviews',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    kind: text('kind', { enum: ['weekly', 'monthly', 'contest', 'simulation'] }).notNull(),
    /** `YYYY-MM-DD` bounds of the period under review. */
    periodStart: text('period_start').notNull(),
    periodEnd: text('period_end').notNull(),
    /** Structured findings computed deterministically by the engines. */
    structured: text('structured', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
    /** Prose narration. Null when no LLM is configured — the app still works (§71). */
    bodyMd: text('body_md'),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [
    index('reviews_kind_idx').on(table.kind),
    uniqueIndex('reviews_period_unique').on(table.kind, table.periodStart, table.periodEnd),
  ],
);

// ===========================================================================
// Coach memory, decisions and goals (§24, §33, §50, §51)
// ===========================================================================

/**
 * Every significant coaching decision, with the evidence behind it and a date
 * to come back and check whether it worked (§50, §51).
 */
export const coachDecisions = sqliteTable(
  'coach_decisions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    at: integer('at').notNull(),
    kind: text('kind').notNull(),
    decision: text('decision').notNull(),
    reason: text('reason').notNull(),
    evidence: text('evidence', { mode: 'json' }).$type<EvidenceItem[]>().notNull(),
    action: text('action', { mode: 'json' }).$type<Record<string, unknown>>(),
    expectedBenefit: text('expected_benefit'),
    targetTopicId: text('target_topic_id').references(() => topicNodes.id, {
      onDelete: 'set null',
    }),
    /** Baseline metrics captured at decision time, so effect can be measured. */
    baseline: text('baseline', { mode: 'json' }).$type<Record<string, number | null>>(),
    /** When to evaluate the intervention. */
    reviewAt: integer('review_at'),
    reviewedAt: integer('reviewed_at'),
    outcome: text('outcome', { enum: ['effective', 'partial', 'ineffective', 'abandoned'] }),
    /** Signed change attributable to the intervention. */
    effectiveness: real('effectiveness'),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [
    index('coach_decisions_review_idx').on(table.reviewAt),
    index('coach_decisions_at_idx').on(table.at),
  ],
);

/** Durable coach memory (§24) — what the assistant knows about the user. */
export const coachMemory = sqliteTable(
  'coach_memory',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    kind: text('kind').notNull(),
    key: text('key').notNull(),
    value: text('value', { mode: 'json' }).$type<unknown>().notNull(),
    /** Relative importance, so the LLM context can be trimmed sensibly. */
    weight: real('weight').notNull().default(1),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [uniqueIndex('coach_memory_unique').on(table.kind, table.key)],
);

export const goals = sqliteTable(
  'goals',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    text: text('text').notNull(),
    kind: text('kind').notNull(),
    /** Machine-checkable target, so progress is inferred rather than self-reported (§33). */
    target: text('target', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
    progress: text('progress', { mode: 'json' }).$type<Record<string, unknown>>(),
    status: text('status', { enum: ['active', 'achieved', 'missed', 'abandoned'] })
      .notNull()
      .default('active'),
    dueDate: text('due_date'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    completedAt: integer('completed_at'),
  },
  (table) => [index('goals_status_idx').on(table.status)],
);

// ===========================================================================
// Operations: sync state and LLM call log (§7, §59, §62)
// ===========================================================================

/** Re-exported from core so the sync engine and providers share one definition. */
export type { SyncCursor } from '@ascend/core';

/**
 * Per-provider, per-resource sync bookkeeping (§7).
 *
 * A failure records an error here and leaves the data alone — §62 requires that
 * a provider outage never destroys what has already been synced.
 */
export const syncState = sqliteTable(
  'sync_state',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    provider: text('provider', providerEnum).notNull(),
    /** e.g. `submissions`, `contests`, `problemset`, `gym_participation`. */
    resource: text('resource').notNull(),
    cursor: text('cursor', { mode: 'json' }).$type<SyncCursor>(),
    status: text('status', {
      enum: ['never_synced', 'syncing', 'up_to_date', 'partially_synced', 'failed'],
    })
      .notNull()
      .default('never_synced'),
    lastAttemptAt: integer('last_attempt_at'),
    lastSuccessAt: integer('last_success_at'),
    /** Human-readable failure, surfaced in the UI rather than swallowed. */
    error: text('error'),
    itemsSynced: integer('items_synced').notNull().default(0),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [uniqueIndex('sync_state_unique').on(table.provider, table.resource)],
);

/** Every LLM call, versioned and logged so output can be debugged (§59). */
export const llmCalls = sqliteTable(
  'llm_calls',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    /** Which prompt was used: `coach`, `contest_analyst`, `code_reviewer`, … */
    purpose: text('purpose').notNull(),
    promptVersion: text('prompt_version').notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    /** Structured input built by the engines — never a raw database dump (§35). */
    input: text('input', { mode: 'json' }).$type<unknown>().notNull(),
    output: text('output', { mode: 'json' }).$type<unknown>(),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    latencyMs: integer('latency_ms'),
    ok: integer('ok', { mode: 'boolean' }).notNull().default(true),
    error: text('error'),
    at: integer('at').notNull(),
  },
  (table) => [
    index('llm_calls_purpose_idx').on(table.purpose),
    index('llm_calls_at_idx').on(table.at),
  ],
);
