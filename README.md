# Ascend

**ICPC Regional Preparation System** — a private, local-first coach that reads your
Codeforces, Codeforces Gym and AtCoder history and tells you what to train today.

> Train with purpose. Compete with confidence.

Everything stays on your machine: no account, no cloud database, no public profile,
no telemetry. Your data lives in `~/.ascend/`.

## Requirements

- Node.js **22+** (built and tested on 24 LTS)
- pnpm **11+** (`corepack enable pnpm`)

## Getting started

```bash
pnpm install
pnpm db:migrate      # creates ~/.ascend/ascend.db
pnpm dev             # server on :5174, web on :5173
```

Open <http://localhost:5173> and complete onboarding.

To run it as a single process instead:

```bash
pnpm build && pnpm --filter @ascend/server start   # http://127.0.0.1:5174
```

The server binds to loopback only, deliberately and non-configurably — it holds
platform credentials and must not be reachable from the network.

## Layout

```
apps/web           Vite + React + Tailwind SPA
apps/server        Fastify API, sync scheduler
packages/core      pure domain logic — zero IO, fully unit-tested
packages/db        Drizzle schema, migrations, repositories
packages/providers Codeforces / Gym / AtCoder adapters   (milestone 2)
packages/llm       AI provider abstraction, prompt registry (milestone 7)
```

Every engine lives in `packages/core` as a plain function over plain evidence
objects. All IO is confined to `apps/server` and `packages/providers`. That split
is what makes the engines testable, and it is why the browser bundle never pulls
in the database package.

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | Server + web dev servers together |
| `pnpm typecheck` | TypeScript across every workspace |
| `pnpm test` | Unit and integration tests (vitest) |
| `pnpm build` | Production SPA build |
| `pnpm db:generate` | Generate a migration after editing the schema |
| `pnpm db:migrate` | Apply pending migrations |

## Configuration

| Variable | Purpose |
|---|---|
| `ASCEND_DATA_DIR` | Override `~/.ascend` (tests use this) |
| `ASCEND_DB_PATH` | Override the database file path |
| `ASCEND_PORT` | API port, default `5174` |
| `ASCEND_PASSPHRASE` | Derive the credential-encryption key from a passphrase instead of a key file |

## Credentials

Credentials are AES-256-GCM encrypted in `~/.ascend/secrets.json` (mode `600`) and
are **write-only** through the API — once stored, no screen and no response can
read them back.

By default the encryption key sits beside the data in `~/.ascend/secret.key`, also
mode `600`. That protects against casual disclosure and stray backups, **not**
against another process running as you. Set `ASCEND_PASSPHRASE` before starting
Ascend to derive the key from a passphrase that is never written to disk.

The **Codeforces session cookie** is needed for Gym submissions, Gym standings and
submission source code — none of which the public Codeforces API exposes. That
cookie grants full access to your Codeforces account while it is valid, and it
expires periodically.

## Design principles

These are enforced, not aspirational:

- **Deterministic logic decides; the LLM only explains.** Analysis, weakness
  detection, planning and recommendation are ordinary code. The model receives a
  compact evidence object built by those engines — never a database dump — and
  writes prose. Ascend works completely without an AI provider configured.
- **No invented numbers.** Every figure comes from your synchronized history. A
  readiness dimension without enough evidence renders an em dash and says what it
  still needs; it never renders 0%. Unbuilt screens show nothing rather than
  plausible sample data.
- **No invented dates.** Ascend will not guess your Regional. "No target
  configured" is a real, designed state.
- **A failed sync never destroys data.** Failures record an error and keep the
  last good cursor, so the retry resumes instead of refetching everything.
- **Every recommendation carries its evidence.** If the coach says practise
  shortest paths, it can show you the submissions that led it there.

## Status

Milestone 1 is complete: application shell, database and migrations, onboarding,
settings, and credential storage. Synchronization (Codeforces, Codeforces Gym,
AtCoder) is milestone 2. The screens for later milestones state plainly what they
will contain and what they are waiting on.
