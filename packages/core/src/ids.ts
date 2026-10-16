import type { Provider } from './types';

/**
 * Stable composite identifiers (spec §49 — "use stable composite IDs where
 * necessary").
 *
 * Every externally-sourced row is keyed by `<prefix>:<provider-specific parts>`
 * so that re-syncing is idempotent and a row's origin is readable at a glance:
 *
 *   contests      cf:1846        gym:104555      ac:abc300
 *   problems      cf:1846:E2     gym:104555:A    ac:abc300_d
 *   submissions   cf:245871003   gym:245871003   ac:60123456
 */

export const PROVIDER_PREFIX: Record<Provider, string> = {
  codeforces: 'cf',
  codeforces_gym: 'gym',
  atcoder: 'ac',
};

const PREFIX_TO_PROVIDER: Record<string, Provider> = {
  cf: 'codeforces',
  gym: 'codeforces_gym',
  ac: 'atcoder',
};

export function contestId(provider: Provider, providerContestId: string | number): string {
  return `${PROVIDER_PREFIX[provider]}:${providerContestId}`;
}

/**
 * @param contestRef The provider's contest identifier (`1846`, `abc300`), not a
 *                   composite id — this keeps callers from double-prefixing.
 */
export function problemId(
  provider: Provider,
  contestRef: string | number,
  index: string,
): string {
  return `${PROVIDER_PREFIX[provider]}:${contestRef}:${index}`;
}

export function submissionId(provider: Provider, providerSubmissionId: string | number): string {
  return `${PROVIDER_PREFIX[provider]}:${providerSubmissionId}`;
}

/** Splits a composite id back into its provider and remaining parts. */
export function parseCompositeId(
  id: string,
): { provider: Provider; parts: string[] } | null {
  const segments = id.split(':');
  const prefix = segments[0];
  if (prefix === undefined || segments.length < 2) return null;

  const provider = PREFIX_TO_PROVIDER[prefix];
  if (provider === undefined) return null;

  return { provider, parts: segments.slice(1) };
}

export function providerOf(id: string): Provider | null {
  return parseCompositeId(id)?.provider ?? null;
}

/**
 * Canonical public URL for a problem, used by the UI so the user can open it on
 * the real judge.
 */
export function problemUrl(
  provider: Provider,
  contestRef: string | number,
  index: string,
): string {
  switch (provider) {
    case 'codeforces':
      return `https://codeforces.com/contest/${contestRef}/problem/${index}`;
    case 'codeforces_gym':
      return `https://codeforces.com/gym/${contestRef}/problem/${index}`;
    case 'atcoder':
      // AtCoder task ids already encode the contest, e.g. abc300_d in abc300.
      return `https://atcoder.jp/contests/${contestRef}/tasks/${index}`;
  }
}

export function contestUrl(provider: Provider, contestRef: string | number): string {
  switch (provider) {
    case 'codeforces':
      return `https://codeforces.com/contest/${contestRef}`;
    case 'codeforces_gym':
      return `https://codeforces.com/gym/${contestRef}`;
    case 'atcoder':
      return `https://atcoder.jp/contests/${contestRef}`;
  }
}
