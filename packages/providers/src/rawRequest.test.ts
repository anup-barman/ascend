import { describe, expect, it } from 'vitest';

import { describeRawRequest } from './rawRequest';

/**
 * Request-identity tests (spec §7).
 *
 * The security case is the one that matters most: an authorized Codeforces call
 * carries `apiKey` and `apiSig` in its query string, and neither may ever be
 * written to the database.
 */

describe('describeRawRequest', () => {
  it('splits a Codeforces API call into endpoint and sorted request key', () => {
    expect(
      describeRawRequest('https://codeforces.com/api/user.status?handle=AnupBarman&from=1&count=1000'),
    ).toEqual({
      provider: 'codeforces',
      endpoint: 'api/user.status',
      requestKey: 'count=1000&from=1&handle=AnupBarman',
    });
  });

  it('gives the same request key regardless of parameter order', () => {
    const a = describeRawRequest('https://codeforces.com/api/user.status?from=1&handle=x');
    const b = describeRawRequest('https://codeforces.com/api/user.status?handle=x&from=1');
    expect(a?.requestKey).toBe(b?.requestKey);
  });

  it('never includes the API key, signature or timestamp', () => {
    const identity = describeRawRequest(
      'https://codeforces.com/api/contest.standings?contestId=104555&apiKey=abc123&time=1756000000&apiSig=123456deadbeef',
    );

    expect(identity).toEqual({
      provider: 'codeforces',
      endpoint: 'api/contest.standings',
      requestKey: 'contestId=104555',
    });
  });

  it('gives an authorized and an unauthorized call the same identity', () => {
    // The signature is per-call, so keeping it would defeat the unique index and
    // append a fresh row on every sync.
    const plain = describeRawRequest('https://codeforces.com/api/contest.list?gym=true');
    const signed = describeRawRequest(
      'https://codeforces.com/api/contest.list?gym=true&apiKey=abc&time=1&apiSig=xyz',
    );
    expect(signed).toEqual(plain);
  });

  it('attributes Gym requests to codeforces', () => {
    // `user.status` returns regular and Gym submissions in one body, so raw
    // payloads follow the transport, not the logical adapter.
    expect(describeRawRequest('https://codeforces.com/api/contest.list?gym=true')?.provider).toBe(
      'codeforces',
    );
  });

  it('reads AtCoder Problems and official AtCoder hosts as atcoder', () => {
    expect(
      describeRawRequest(
        'https://kenkoooo.com/atcoder/atcoder-api/v3/user/submissions?user=x&from_second=0',
      ),
    ).toEqual({
      provider: 'atcoder',
      endpoint: 'atcoder/atcoder-api/v3/user/submissions',
      requestKey: 'from_second=0&user=x',
    });

    expect(describeRawRequest('https://atcoder.jp/users/x/history/json')).toEqual({
      provider: 'atcoder',
      endpoint: 'users/x/history/json',
      requestKey: '',
    });
  });

  it('reports no identity for a host that is not a provider', () => {
    expect(describeRawRequest('https://example.test/whatever')).toBeNull();
  });

  it('reports no identity for an unparseable URL', () => {
    expect(describeRawRequest('not a url')).toBeNull();
  });
});
