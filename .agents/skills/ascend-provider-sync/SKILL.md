---
name: ascend-provider-sync
description: Use when implementing or changing Codeforces, Codeforces Gym, or AtCoder data ingestion, normalization, caching, retries, checkpoints, sync status, and provider adapters in ICPC Ascend.
---

# Ascend Provider Synchronization

## Workflow
1. Inspect current adapter interfaces and database constraints before changing code. Keep the providers limited to Codeforces, a dedicated Codeforces Gym adapter, and AtCoder.
2. Verify each field and endpoint against current authoritative documentation and an actual response or saved fixture. Record fields that are unavailable, restricted, or unreliable; never guess them.
3. Define raw response shape, normalized entity mapping, stable provider identifiers, timestamps/time zones, and deduplication rules before implementing persistence.
4. Implement idempotent incremental sync. Prefer known IDs/cursors and update checkpoints only after successful persistence.
5. Apply request timeouts, rate-limit-aware scheduling, bounded retries with exponential backoff for transient errors, and explicit cancellation where supported.
6. Use transactions and upserts so duplicate data is harmless. A failed or partial provider run must not erase successful historical records.
7. Return typed provider outcomes that distinguish success, partial success, empty account, unsupported data, rate limit, access denial, malformed response, network failure, and stale cache.
8. Test normal, duplicate, out-of-order, missing-field, malformed-response, rate-limit, timeout, partial-failure, resume-after-failure, and migration scenarios using fixtures. Keep network integration tests separate from deterministic unit tests.
9. Expose provider-specific last successful sync time, last attempt, status, and actionable error details without leaking secrets.

## Completion criteria
- Existing cached records survive all simulated provider failures.
- Repeating the same sync does not create duplicates or change results.
- Checkpoints cannot skip records after a failed database write.
- Unsupported fields are omitted/marked unavailable, not filled with guessed values.
- Gym is not silently treated as an ordinary Codeforces problem set.
