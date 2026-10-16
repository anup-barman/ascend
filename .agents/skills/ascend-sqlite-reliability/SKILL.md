---
name: ascend-sqlite-reliability
description: Use when designing or changing ICPC Ascend's SQLite schema, indexes, transactions, migrations, data retention, backup/restore, repository queries, or database tests.
---

# Ascend SQLite Reliability

## Workflow
1. Inspect the live schema, migration history, ORM/repository layer, and current SQLite connection options before changing data structures.
2. Make every schema change a numbered, forward migration. Do not edit an already-applied migration to change a deployed database's history; add a new migration instead.
3. Enable and verify foreign-key enforcement for every connection. Define primary keys, unique constraints, CHECK constraints, and ON DELETE behavior intentionally.
4. Wrap each logically atomic write/sync batch in a transaction. On any write failure, roll back the batch and do not advance the sync checkpoint.
5. Use stable composite provider IDs to deduplicate external records. Treat raw provider payloads and normalized entities as related but distinct data with clear provenance.
6. Design indexes from real query patterns: recent submissions by handle/time, contests by provider/time, problem-tag lookup, topic evidence windows, and decision history. Confirm query plans before adding speculative indexes.
7. Define UTC storage and display-time conversion consistently. Test null/missing provider timestamps and daylight-saving/time-zone boundaries.
8. Test fresh database creation, upgrade from each supported migration baseline, rollback/failure behavior where supported, unique-conflict handling, foreign-key integrity, restart persistence, backup/restore, and partial sync failure.
9. Keep test databases isolated from the user's real local database. Never run destructive reset/drop commands against real data without explicit approval and a verified backup.
10. Preserve cached history when an external source is unavailable. Do not convert a failed fetch into an empty authoritative result or issue deletes based on incomplete snapshots.

## Completion criteria
- Migrations can run on a clean database and on the existing schema without losing user data.
- Sync writes are idempotent and transactional where consistency requires it.
- Foreign-key checks and uniqueness constraints are exercised by tests.
- Database behavior is verified by querying the resulting database, not inferred from ORM types alone.
