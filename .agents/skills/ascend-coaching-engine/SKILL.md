---
name: ascend-coaching-engine
description: Use when implementing ICPC readiness scores, topic taxonomy, mastery, weakness detection, spaced repetition, training phase routing, daily plans, problem rankings, contest strategy, or post-contest analysis for ICPC Ascend.
---

# Ascend Deterministic Coaching Engine

## Workflow
1. Define typed inputs and outputs for the decision. Use normalized persisted records; do not send the entire database blindly to an LLM.
2. Keep scoring, topic mapping, mastery updates, forgetting/review schedules, phase selection, training-time budgeting, and recommendation ranking deterministic and testable.
3. Version scoring weights/formulas and record the version used for each material decision so historical reports remain interpretable after algorithm changes.
4. For every recommendation, store: action, objective, reason, evidence references/counts, expected benefit, confidence/evidence coverage, created time, and engine version.
5. Use topic-specific evidence rather than broad solve totals alone. Separate subskills where enough evidence exists; otherwise keep the parent topic and explicitly mark low confidence.
6. Account for solve independence, hints/editorials, difficulty, recency, repeated attempts, contest time pressure, and topic tagging quality. Do not treat one AC as mastery.
7. Respect the user's available time and target contest date. Make final-14-day and final-3-day behavior explicit, deterministic, and unit-tested. Never invent a target date.
8. Rank only real, known problems with verified metadata. Explain why each was selected; do not recommend prior solves unless deliberately scheduled for review.
9. Pass a compact, structured decision summary to the LLM only for explanation or nuanced synthesis. Validate structured outputs; reject unsupported entities or numeric claims that do not map to the supplied evidence.

## Required tests
- Empty and sparse history; missing or conflicting tags; recently improved versus stale skills; assisted versus independent solves; duplicate records; unusual dates/time zones; zero or negative available time; target date missing/past; identical candidate scores; previously solved candidates; changing formula versions.

## Product rule
The objective is stronger ICPC performance, not a cosmetically impressive single score. Display detailed dimensions and evidence coverage; suppress fake precision.
