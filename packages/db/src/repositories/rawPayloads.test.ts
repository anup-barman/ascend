import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { openDatabase, type OpenedDatabase } from '../client';
import { runMigrations } from '../migrate';
import { getRawPayload, MAX_RAW_BODY_BYTES, recordRawPayload } from './rawPayloads';

/**
 * Raw-payload storage tests (spec §7).
 *
 * The cases that matter are the ones where a re-fetch could destroy a payload
 * that was still good: the same request fetched twice, a conditional 304 whose
 * body came from the cache, an empty body from a broken response, and a body too
 * large to keep.
 */

let dir: string;
let opened: OpenedDatabase;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ascend-raw-'));
  opened = openDatabase(join(dir, 'ascend.db'));
  runMigrations(opened.db);
});

afterEach(() => {
  opened.close();
  rmSync(dir, { recursive: true, force: true });
});

/** Row count straight from SQLite, bypassing the code under test. */
function count(): number {
  const row = opened.sqlite
    .prepare<[], { n: number }>('select count(*) as n from raw_payloads')
    .get();
  return row?.n ?? 0;
}

describe('recordRawPayload', () => {
  it('stores a body and reads it back', () => {
    const result = recordRawPayload(opened.db, {
      provider: 'codeforces',
      endpoint: 'api/user.status',
      requestKey: 'count=1000&from=1&handle=AnupBarman',
      httpStatus: 200,
      body: '{"status":"OK"}',
      fetchedAt: 1_756_000_000,
    });

    expect(result).toEqual({ stored: true, bodyBytes: 15 });
    expect(
      getRawPayload(opened.db, 'codeforces', 'api/user.status', 'count=1000&from=1&handle=AnupBarman'),
    ).toEqual({
      provider: 'codeforces',
      endpoint: 'api/user.status',
      requestKey: 'count=1000&from=1&handle=AnupBarman',
      httpStatus: 200,
      fetchedAt: 1_756_000_000,
      body: '{"status":"OK"}',
      bodyBytes: 15,
      bodyOmitted: false,
    });
  });

  it('keeps one row per request key and updates it in place', () => {
    recordRawPayload(opened.db, {
      provider: 'atcoder',
      endpoint: 'atcoder-api/v3/user/submissions',
      requestKey: 'from_second=0&user=x',
      httpStatus: 200,
      body: '[1]',
      fetchedAt: 1_756_000_000,
    });
    recordRawPayload(opened.db, {
      provider: 'atcoder',
      endpoint: 'atcoder-api/v3/user/submissions',
      requestKey: 'from_second=0&user=x',
      httpStatus: 200,
      body: '[1,2]',
      fetchedAt: 1_756_000_500,
    });

    expect(count()).toBe(1);
    const stored = getRawPayload(
      opened.db,
      'atcoder',
      'atcoder-api/v3/user/submissions',
      'from_second=0&user=x',
    );
    expect(stored?.body).toBe('[1,2]');
    expect(stored?.fetchedAt).toBe(1_756_000_500);
  });

  it('treats a different request key on the same endpoint as a separate payload', () => {
    for (const from of ['0', '1756000000']) {
      recordRawPayload(opened.db, {
        provider: 'atcoder',
        endpoint: 'atcoder-api/v3/user/submissions',
        requestKey: `from_second=${from}&user=x`,
        body: '[]',
      });
    }

    expect(count()).toBe(2);
  });

  it('defaults the request key to an empty string for a query-less endpoint', () => {
    recordRawPayload(opened.db, {
      provider: 'atcoder',
      endpoint: 'resources/contests.json',
      body: '[]',
    });

    expect(getRawPayload(opened.db, 'atcoder', 'resources/contests.json')?.requestKey).toBe('');
  });

  it('does not let an empty body erase a stored one', () => {
    recordRawPayload(opened.db, {
      provider: 'codeforces',
      endpoint: 'api/contest.list',
      requestKey: 'gym=true',
      httpStatus: 200,
      body: '{"result":[1,2,3]}',
      fetchedAt: 1_756_000_000,
    });

    // A 304 hands back the cached body, so this is the pathological case: a
    // response read as success that carried nothing.
    recordRawPayload(opened.db, {
      provider: 'codeforces',
      endpoint: 'api/contest.list',
      requestKey: 'gym=true',
      httpStatus: 200,
      body: '',
      fetchedAt: 1_756_000_900,
    });

    const stored = getRawPayload(opened.db, 'codeforces', 'api/contest.list', 'gym=true');
    expect(stored?.body).toBe('{"result":[1,2,3]}');
    expect(stored?.bodyBytes).toBe(18);
    // The attempt is still visible, so the row does not claim to be fresher
    // than the body it holds by accident.
    expect(stored?.fetchedAt).toBe(1_756_000_900);
  });

  it('records an oversized body as omitted rather than storing part of it', () => {
    const body = 'x'.repeat(MAX_RAW_BODY_BYTES + 1);

    const result = recordRawPayload(opened.db, {
      provider: 'atcoder',
      endpoint: 'resources/problem-models.json',
      httpStatus: 200,
      body,
    });

    expect(result).toEqual({ stored: false, bodyBytes: MAX_RAW_BODY_BYTES + 1 });
    const stored = getRawPayload(opened.db, 'atcoder', 'resources/problem-models.json');
    expect(stored?.body).toBe('');
    expect(stored?.bodyOmitted).toBe(true);
    expect(stored?.bodyBytes).toBe(MAX_RAW_BODY_BYTES + 1);
  });

  it('stores a body exactly at the cap', () => {
    const result = recordRawPayload(opened.db, {
      provider: 'atcoder',
      endpoint: 'resources/problems.json',
      body: 'x'.repeat(MAX_RAW_BODY_BYTES),
    });

    expect(result.stored).toBe(true);
    expect(getRawPayload(opened.db, 'atcoder', 'resources/problems.json')?.bodyOmitted).toBe(false);
  });

  it('marks a payload omitted when a later fetch is oversized', () => {
    recordRawPayload(opened.db, {
      provider: 'atcoder',
      endpoint: 'resources/problem-models.json',
      body: '{"small":1}',
    });
    recordRawPayload(opened.db, {
      provider: 'atcoder',
      endpoint: 'resources/problem-models.json',
      body: 'x'.repeat(MAX_RAW_BODY_BYTES + 1),
    });

    // Reporting the payload as absent beats leaving a stale body that looks
    // current (§58).
    const stored = getRawPayload(opened.db, 'atcoder', 'resources/problem-models.json');
    expect(stored?.bodyOmitted).toBe(true);
    expect(stored?.body).toBe('');
    expect(count()).toBe(1);
  });

  it('measures the body in bytes, not characters', () => {
    const result = recordRawPayload(opened.db, {
      provider: 'atcoder',
      endpoint: 'contests/abc300/tasks/abc300_a',
      body: '高橋君',
    });

    expect(result.bodyBytes).toBe(9);
  });

  it('reports no payload for a request that was never stored', () => {
    expect(getRawPayload(opened.db, 'codeforces', 'api/user.info', 'handles=nobody')).toBeUndefined();
  });
});
