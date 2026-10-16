import { describe, expect, it, vi } from 'vitest';

import { BotProtectionError, ProviderError, RateLimitedError } from './errors';
import {
  backoffDelayMs,
  HostRateLimiter,
  HttpClient,
  MemoryCacheStore,
  parseRetryAfterMs,
} from './http';
import type { HttpResponseEvent } from './http';

describe('HostRateLimiter', () => {
  it('spaces requests to the same host by the configured interval', async () => {
    const sleeps: number[] = [];
    let clock = 0;
    const limiter = new HostRateLimiter(
      { 'slow.test': 100 },
      50,
      async (ms) => {
        sleeps.push(ms);
        clock += ms;
      },
      () => clock,
    );

    const order: number[] = [];
    await Promise.all([
      limiter.schedule('slow.test', async () => order.push(1)),
      limiter.schedule('slow.test', async () => order.push(2)),
      limiter.schedule('slow.test', async () => order.push(3)),
    ]);

    expect(order).toEqual([1, 2, 3]);
    // First runs immediately; each subsequent one waits a full interval.
    expect(sleeps).toEqual([100, 100]);
  });

  it('does not make one host wait behind another', async () => {
    const sleeps: number[] = [];
    let clock = 0;
    const limiter = new HostRateLimiter(
      { 'a.test': 100, 'b.test': 100 },
      50,
      async (ms) => {
        sleeps.push(ms);
        clock += ms;
      },
      () => clock,
    );

    await Promise.all([
      limiter.schedule('a.test', async () => 'a'),
      limiter.schedule('b.test', async () => 'b'),
    ]);

    expect(sleeps).toEqual([]);
  });

  it('releases the host chain even when a task throws', async () => {
    const limiter = new HostRateLimiter({ 'x.test': 0 }, 0, async () => {}, () => 0);

    await expect(
      limiter.schedule('x.test', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    // A jammed chain would hang here instead of resolving.
    await expect(limiter.schedule('x.test', async () => 'ok')).resolves.toBe('ok');
  });

  it('uses the documented Codeforces and kenkoooo intervals by default', () => {
    const limiter = new HostRateLimiter();
    expect(limiter.intervalFor('codeforces.com')).toBe(2100);
    expect(limiter.intervalFor('kenkoooo.com')).toBe(1100);
    expect(limiter.intervalFor('unknown.test')).toBe(1000);
  });
});

describe('backoffDelayMs', () => {
  it('grows exponentially and is capped', () => {
    const noJitter = { random: () => 1 };
    expect(backoffDelayMs(0, noJitter)).toBe(1000);
    expect(backoffDelayMs(1, noJitter)).toBe(2000);
    expect(backoffDelayMs(2, noJitter)).toBe(4000);
    expect(backoffDelayMs(20, noJitter)).toBe(30_000);
  });

  it('applies jitter between half and full the ceiling', () => {
    expect(backoffDelayMs(1, { random: () => 0 })).toBe(1000);
    expect(backoffDelayMs(1, { random: () => 1 })).toBe(2000);
  });
});

describe('parseRetryAfterMs', () => {
  it('reads a seconds value', () => {
    expect(parseRetryAfterMs('5')).toBe(5000);
  });

  it('reads an HTTP date', () => {
    const now = Date.parse('2026-08-28T12:00:00Z');
    expect(parseRetryAfterMs('Fri, 28 Aug 2026 12:00:30 GMT', now)).toBe(30_000);
  });

  it('never returns a negative delay', () => {
    const now = Date.parse('2026-08-28T12:00:00Z');
    expect(parseRetryAfterMs('Fri, 28 Aug 2026 11:59:00 GMT', now)).toBe(0);
  });

  it('returns undefined for a missing or unparseable header', () => {
    expect(parseRetryAfterMs(null)).toBeUndefined();
    expect(parseRetryAfterMs('soon')).toBeUndefined();
  });
});

/** A client whose sleeps are instant and whose fetch is scripted. */
function testClient(responses: (() => Response)[]) {
  const calls: string[] = [];
  const fetchImpl = vi.fn(async (input: Parameters<typeof fetch>[0]) => {
    calls.push(String(input));
    const next = responses.shift();
    if (!next) throw new Error('no scripted response left');
    return next();
  }) as unknown as typeof fetch;

  const client = new HttpClient({
    fetchImpl,
    sleep: async () => {},
    limiter: new HostRateLimiter({}, 0, async () => {}, () => 0),
    cache: new MemoryCacheStore(),
    maxRetries: 2,
  });

  return { client, calls };
}

describe('HttpClient', () => {
  it('returns a parsed body', async () => {
    const { client } = testClient([() => new Response('{"ok":true}', { status: 200 })]);
    await expect(client.getJson<{ ok: boolean }>('https://x.test/a')).resolves.toEqual({ ok: true });
  });

  it('revalidates conditionally and reuses the cached body on 304', async () => {
    const { client, calls } = testClient([
      () => new Response('{"v":1}', { status: 200, headers: { etag: 'W/"1"' } }),
      // 304 is a null-body status; passing a body to the constructor throws.
      () => new Response(null, { status: 304 }),
    ]);

    const first = await client.get('https://x.test/big.json', { conditional: true });
    expect(first.fromCache).toBe(false);

    const second = await client.get('https://x.test/big.json', { conditional: true });
    expect(second.fromCache).toBe(true);
    expect(second.text).toBe('{"v":1}');
    expect(calls).toHaveLength(2);
  });

  it('retries a 500 and then succeeds', async () => {
    const { client, calls } = testClient([
      () => new Response('nope', { status: 500 }),
      () => new Response('{"ok":1}', { status: 200 }),
    ]);

    await expect(client.getJson('https://x.test/a')).resolves.toEqual({ ok: 1 });
    expect(calls).toHaveLength(2);
  });

  it('gives up after maxRetries and reports a retryable error', async () => {
    const { client, calls } = testClient([
      () => new Response('', { status: 503 }),
      () => new Response('', { status: 503 }),
      () => new Response('', { status: 503 }),
    ]);

    await expect(client.get('https://x.test/a')).rejects.toThrow(ProviderError);
    expect(calls).toHaveLength(3); // initial + 2 retries
  });

  it('honours Retry-After on 429', async () => {
    const sleeps: number[] = [];
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 429, headers: { 'retry-after': '7' } }))
      .mockResolvedValueOnce(new Response('{"ok":1}', { status: 200 })) as unknown as typeof fetch;

    const client = new HttpClient({
      fetchImpl,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      limiter: new HostRateLimiter({}, 0, async () => {}, () => 0),
      maxRetries: 2,
    });

    await expect(client.getJson('https://x.test/a')).resolves.toEqual({ ok: 1 });
    expect(sleeps).toEqual([7000]);
  });

  it('recognises a Cloudflare challenge as permanent and does not retry', async () => {
    const { client, calls } = testClient([
      () =>
        new Response('<html><body>Just a moment...</body></html>', {
          status: 403,
          headers: { 'cf-mitigated': 'challenge', server: 'cloudflare' },
        }),
    ]);

    const error = await client.get('https://codeforces.com/contest/1/submission/2').catch((e) => e);
    expect(error).toBeInstanceOf(BotProtectionError);
    expect(error.retryable).toBe(false);
    // Retrying a permanent block would just burn the rate limit.
    expect(calls).toHaveLength(1);
  });

  it('does not retry an ordinary 404', async () => {
    const { client, calls } = testClient([() => new Response('', { status: 404 })]);
    await expect(client.get('https://x.test/missing')).rejects.toThrow(ProviderError);
    expect(calls).toHaveLength(1);
  });

  it('reports invalid JSON as a non-retryable provider error', async () => {
    const { client } = testClient([() => new Response('<html>oops</html>', { status: 200 })]);
    await expect(client.getJson('https://x.test/a')).rejects.toThrow(/did not return valid JSON/);
  });

  it('wraps a network failure as retryable', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('ECONNRESET');
    }) as unknown as typeof fetch;

    const client = new HttpClient({
      fetchImpl,
      sleep: async () => {},
      limiter: new HostRateLimiter({}, 0, async () => {}, () => 0),
      maxRetries: 0,
    });

    const error = await client.get('https://x.test/a').catch((e) => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect((error as ProviderError).retryable).toBe(true);
  });
});

/** §7: the hook that lets the server persist raw responses for offline replay. */
describe('HttpClient onResponse', () => {
  function hookClient(responses: (() => Response)[]) {
    const events: HttpResponseEvent[] = [];
    const fetchImpl = vi.fn(async () => {
      const next = responses.shift();
      if (!next) throw new Error('no scripted response left');
      return next();
    }) as unknown as typeof fetch;

    const client = new HttpClient({
      fetchImpl,
      sleep: async () => {},
      limiter: new HostRateLimiter({}, 0, async () => {}, () => 0),
      cache: new MemoryCacheStore(),
      maxRetries: 2,
      onResponse: (event) => events.push(event),
    });

    return { client, events };
  }

  it('reports the url, status and body of a fresh response', async () => {
    const { client, events } = hookClient([() => new Response('{"ok":true}', { status: 200 })]);

    await client.get('https://x.test/a?q=1');

    expect(events).toEqual([
      { url: 'https://x.test/a?q=1', status: 200, text: '{"ok":true}', fromCache: false },
    ]);
  });

  it('fires on a 304 with the cached body, not an empty one', async () => {
    const { client, events } = hookClient([
      () => new Response('{"v":1}', { status: 200, headers: { etag: 'W/"1"' } }),
      () => new Response(null, { status: 304 }),
    ]);

    await client.get('https://x.test/big.json', { conditional: true });
    await client.get('https://x.test/big.json', { conditional: true });

    expect(events).toHaveLength(2);
    // Storing the 304's own empty body would erase a good raw payload.
    expect(events[1]).toEqual({
      url: 'https://x.test/big.json',
      status: 304,
      text: '{"v":1}',
      fromCache: true,
    });
  });

  it('does not fire for a response that produced no payload', async () => {
    const { client, events } = hookClient([
      () => new Response('nope', { status: 500 }),
      () => new Response('{"ok":1}', { status: 200 }),
    ]);

    await client.get('https://x.test/a');

    // The failed attempt has no body worth replaying; only the one the adapter
    // actually parses is reported.
    expect(events).toHaveLength(1);
    expect(events[0]?.status).toBe(200);
  });

  it('does not fire for a Cloudflare challenge', async () => {
    const { client, events } = hookClient([
      () =>
        new Response('<html><body>Just a moment...</body></html>', {
          status: 403,
          headers: { 'cf-mitigated': 'challenge', server: 'cloudflare' },
        }),
    ]);

    await client.get('https://codeforces.com/contest/1/submission/2').catch(() => {});

    expect(events).toEqual([]);
  });
});

describe('RateLimitedError', () => {
  it('is retryable and carries the advised delay', () => {
    const error = new RateLimitedError('slow down', 1234);
    expect(error.retryable).toBe(true);
    expect(error.retryAfterMs).toBe(1234);
  });
});
