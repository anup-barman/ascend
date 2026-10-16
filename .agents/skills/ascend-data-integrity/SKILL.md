---
name: ascend-data-integrity
description: Use when displaying user statistics, evaluating readiness, detecting weaknesses, producing recommendations, interpreting synchronized data, or generating AI coaching for ICPC Ascend. Enforces evidence-backed claims and prevents invented metrics.
---

# Ascend Data Integrity

## Workflow
1. Identify the authoritative persisted records and the date window relevant to the claim. Inspect types, schema, and query logic; do not infer unseen data.
2. Label information as one of: observed, deterministically derived, estimated, LLM interpretation, or unavailable.
3. For derived metrics, state/check the exact formula, denominator, filters, timestamp semantics, and sample size. Define behavior for empty and partially synchronized datasets.
4. Trace user-facing recommendations to stable problem/submission/contest/topic records or explicit aggregates. Retain a compact evidence payload that can power a “Why this?” view.
5. If evidence is sparse or contradictory, lower confidence or return “not enough data”; never invent a plausible value to make the screen look complete.
6. Validate examples against fixtures and adversarial edge cases: no submissions, only failures, duplicate submissions, missing tags/ratings, partial sync, stale cache, and provider errors.

## Non-negotiable rules
- Never fabricate platform data or personal history.
- Distinguish “no activity” from “activity not available.”
- A model-generated explanation is not itself evidence.
- Example/mock records must be isolated to tests or explicitly marked demo data and never mixed with real records.
- Every scoring claim should be reproducible from data and a versioned calculation.
