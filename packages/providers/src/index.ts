/**
 * @ascend/providers — Codeforces, Codeforces Gym and AtCoder adapters (spec §61).
 *
 * Provider-specific shapes stop here. Everything downstream sees only the
 * normalized entities in `./types`.
 */

export * from './errors';
export * from './http';
export * from './rawRequest';
export * from './types';

export { CodeforcesApi, buildApiSig } from './codeforces/api';
export type { CfCredentials } from './codeforces/api';
export { CodeforcesSource } from './codeforces/source';
export { CodeforcesAdapter, CodeforcesGymAdapter } from './codeforces/adapter';
export {
  deriveContestResults,
  isIcpcStyleGymContest,
  ICPC_PENALTY_PER_REJECTION,
} from './codeforces/normalize';

export { AtCoderApi, decodeHtmlEntities } from './atcoder/api';
export { AtCoderAdapter } from './atcoder/adapter';
export { correctDifficulty, normalizeVerdict, contestIdFromScreenName } from './atcoder/normalize';

import { HttpClient } from './http';
import type { HttpClientOptions } from './http';
import { CodeforcesApi } from './codeforces/api';
import type { CfCredentials } from './codeforces/api';
import { CodeforcesSource } from './codeforces/source';
import { CodeforcesAdapter, CodeforcesGymAdapter } from './codeforces/adapter';
import { AtCoderApi } from './atcoder/api';
import { AtCoderAdapter } from './atcoder/adapter';
import type { PlatformAdapter } from './types';

export interface AdapterSet {
  codeforces: CodeforcesAdapter;
  codeforcesGym: CodeforcesGymAdapter;
  atcoder: AtCoderAdapter;
  /**
   * Sync order. Both Codeforces adapters consume one memoized `user.status`
   * pass, so their relative order carries no weight — §37's source priority is
   * applied when the data is *scored*, not when it is fetched.
   */
  all: PlatformAdapter[];
  http: HttpClient;
}

/**
 * Builds the three adapters over one shared HTTP client, so the per-host rate
 * limits are enforced across all of them rather than per adapter.
 */
export function createAdapters(
  options: {
    codeforcesCredentials?: CfCredentials | null;
    http?: HttpClientOptions;
  } = {},
): AdapterSet {
  const http = new HttpClient(options.http ?? {});

  const cfApi = new CodeforcesApi(http, options.codeforcesCredentials ?? null);
  const cfSource = new CodeforcesSource(cfApi);

  const codeforces = new CodeforcesAdapter(cfApi, cfSource);
  const codeforcesGym = new CodeforcesGymAdapter(cfApi, cfSource);
  const atcoder = new AtCoderAdapter(new AtCoderApi(http));

  return {
    codeforces,
    codeforcesGym,
    atcoder,
    all: [codeforces, codeforcesGym, atcoder],
    http,
  };
}
