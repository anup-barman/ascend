import type { Provider } from '@ascend/core';

/**
 * Maps a request URL onto the `(provider, endpoint, request_key)` identity that
 * §7's `raw_payloads` table stores a response under.
 *
 * This lives here because it encodes provider URL structure, and it is pure so
 * the server can call it from an `onResponse` hook without any IO.
 */

/** Host → provider. Unknown hosts are not attributed and are not stored. */
const PROVIDER_BY_HOST: Record<string, Provider> = {
  'codeforces.com': 'codeforces',
  'kenkoooo.com': 'atcoder',
  'atcoder.jp': 'atcoder',
};

/**
 * Query parameters dropped from the request key.
 *
 * `apiKey` and `apiSig` are credentials and must never reach the database;
 * `time` is part of the signature, so keeping it would make every authorized
 * call look like a new request and defeat the unique index.
 */
const EXCLUDED_PARAMS = new Set(['apiKey', 'apiSig', 'time']);

export interface RawRequestIdentity {
  provider: Provider;
  /** URL path without its leading slash, e.g. `api/user.status`. */
  endpoint: string;
  /** Sorted, credential-free query string. Empty when the URL has no query. */
  requestKey: string;
}

/**
 * Returns the storage identity for `url`, or `null` when the host is not one of
 * ours and the response is therefore not a provider payload.
 *
 * Codeforces and Codeforces Gym both resolve to `codeforces`: `user.status`
 * returns one stream serving both adapters, so attributing raw bodies to the
 * transport rather than to the logical adapter is what actually matches the
 * responses on the wire.
 */
export function describeRawRequest(url: string): RawRequestIdentity | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  const provider = PROVIDER_BY_HOST[parsed.host];
  if (!provider) return null;

  const params = new URLSearchParams(parsed.search);
  for (const name of EXCLUDED_PARAMS) params.delete(name);
  params.sort();

  return {
    provider,
    endpoint: parsed.pathname.replace(/^\/+/, ''),
    requestKey: params.toString(),
  };
}
