---
trigger: always_on
description: Non-negotiable product scope, evidence, architecture, data-integrity, and verification rules for ICPC Ascend.
---

# ICPC Ascend — Engineering Guardrails

## Product scope
- Build a private, single-user, local-first ICPC Regional preparation system. The supported data sources are Codeforces, Codeforces Gym, and AtCoder only.
- Keep features tied to improving ICPC readiness. Do not add social feeds, public profiles, unrelated platforms, or a generic chatbot dashboard.
- Treat the supplied project specification as the product source of truth. If the repository already contains code, inspect it before proposing migrations; preserve useful work and do not rewrite blindly.

## Truth and evidence
- Never fabricate user metrics, ratings, contest results, solves, submission verdicts, tags, difficulty values, timestamps, sync status, weaknesses, or readiness percentages.
- Distinguish observed facts, deterministic inferences, LLM-generated explanations, estimates, and unavailable data. Show sample size, date window, source, and confidence when relevant.
- If evidence is insufficient, say so and show an explicit unavailable/insufficient-data state. Do not silently replace real results with illustrative mock data in production paths.
- Every recommendation must be explainable from persisted application evidence: reason, source records or counts, expected benefit, and confidence/limitations.
- Verify current provider/framework APIs from authoritative documentation or real responses before implementation. Never invent endpoint names, response fields, scraping behavior, or SDK methods.

## Architecture and persistence
- Inspect the repository and document the actual frontend, runtime/backend, database, sync engine, AI integration, scripts, and tests before major changes.
- Keep one authoritative backend/runtime unless an Architecture Decision Record (ADR) justifies another process. In particular, document the packaging and maintenance trade-offs before combining Tauri with a Node.js sidecar.
- SQLite is the local source of truth. Use versioned migrations, transactions, appropriate constraints/indexes, and tests for migrations. Preserve raw provider payloads where practical alongside normalized records.
- Keep core analytics and planning functional without an LLM. The LLM may explain structured evidence, review supplied code, and produce coaching prose; it must not be the database or deterministic decision engine.

## Synchronization correctness
- Sync must be idempotent, incremental, rate-limited, bounded by timeouts, retry transient failures with backoff, and expose per-provider status and last-success timestamps.
- A provider failure or partial sync must never delete valid cached data. Commit sync cursors/checkpoints only after the corresponding data is safely persisted.
- Distinguish empty history from unavailable history, unsupported data, access denial, rate limiting, and temporary provider failure.
- Prove Codeforces Gym and AtCoder data availability with a small provider feasibility spike and saved fixtures before designing the complete sync layer. Never claim unsupported fields exist.

## Coaching correctness
- Readiness, mastery, topic mapping, weakness detection, phase routing, review scheduling, and problem ranking must be deterministic, versioned, and unit-tested.
- Do not hardcode example values from mockups as real data. Avoid fake precision: expose evidence coverage and confidence; do not show a percentage when the available evidence cannot support it.
- Do not count an editorial-assisted solve as equivalent to an independent solve. Avoid recommending already-solved problems except when explicitly labeled as revision.

## Frontend quality
- Use a coherent design system and a focused, professional ICPC training-command-center identity. Prioritize Today's Mission, evidence-backed weaknesses, and next actions over vanity metrics.
- Every screen needs realistic loading, empty, partial-data, offline, error, and success states where applicable. Buttons must perform their advertised actions. No dead controls or placeholder charts presented as real analytics.
- Verify keyboard access, visible focus, accessible labels/contrast, responsive layouts, and reduced-motion behavior. Inspect the rendered application with browser automation/screenshots; code inspection alone does not prove UI correctness.

## Execution and completion
- Work in small, testable vertical slices. Before major implementation, explain the data model, user interaction flow, affected modules, and acceptance criteria in the plan/ADR.
- For behavior changes, write or update tests before/alongside implementation. Run relevant formatting, lint, type-check, unit, integration, migration, and production-build checks; run browser/E2E checks for important UI flows.
- Report the exact checks actually run and their outcomes. Never say a command passed if it was not run. If blocked, state the blocker and leave a reproducible next step.
- Never silently skip failing tests, weaken assertions just to pass, swallow errors, or change expected behavior only to satisfy the test suite.
