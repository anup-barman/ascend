import type { Provider } from '@ascend/core';

import { CredentialError } from '../errors';
import type {
  NormalizedUserProfile,
  PlatformAdapter,
  ProviderFetchResult,
  SyncRequest,
} from '../types';
import type { CodeforcesApi } from './api';
import { normalizeUser } from './normalize';
import type { CodeforcesSource } from './source';

/**
 * The two Codeforces adapters (spec §61).
 *
 * Both read from a shared `CodeforcesSource`, because `user.status` returns
 * regular and Gym submissions in one stream and the API tolerates one request
 * every two seconds — paging the history twice would be wasteful and slow.
 *
 * Neither adapter implements `getSubmissionSource`. Every codeforces.com HTML
 * page is served behind a Cloudflare managed challenge that no HTTP client and
 * no headless browser clears, so submission source cannot be fetched
 * programmatically. The code analyzer accepts pasted source for Codeforces
 * instead of pretending otherwise.
 */

export class CodeforcesAdapter implements PlatformAdapter {
  readonly provider: Provider = 'codeforces';
  readonly label = 'Codeforces';

  constructor(
    private readonly api: CodeforcesApi,
    private readonly source: CodeforcesSource,
  ) {}

  async getUserProfile(handle: string): Promise<NormalizedUserProfile> {
    const [user] = await this.api.userInfo([handle]);
    if (!user) throw new CredentialError(`Codeforces has no user "${handle}".`);
    return normalizeUser(user);
  }

  async sync(request: SyncRequest): Promise<ProviderFetchResult> {
    const bundle = await this.source.load(request.handle, request.cursor);
    return bundle.regular;
  }
}

export class CodeforcesGymAdapter implements PlatformAdapter {
  readonly provider: Provider = 'codeforces_gym';
  readonly label = 'Codeforces Gym';

  constructor(
    private readonly api: CodeforcesApi,
    private readonly source: CodeforcesSource,
  ) {}

  /** Gym shares the Codeforces identity (§1), so this is the same profile. */
  async getUserProfile(handle: string): Promise<NormalizedUserProfile> {
    const [user] = await this.api.userInfo([handle]);
    if (!user) throw new CredentialError(`Codeforces has no user "${handle}".`);
    return { ...normalizeUser(user), provider: 'codeforces_gym' };
  }

  async sync(request: SyncRequest): Promise<ProviderFetchResult> {
    const bundle = await this.source.load(request.handle, request.cursor);
    const result = bundle.gym;

    // Standings would add ranks, the full problem list and official penalties,
    // but Gym standings require API credentials. Everything §19/§20 needs is
    // already derived from the submission stream, so this is an enrichment gap,
    // not a functional one — say so plainly rather than silently omitting it.
    if (!this.api.hasCredentials && result.submissions.length > 0) {
      result.warnings = [
        ...result.warnings,
        'Gym standings were skipped: they need a Codeforces API key (Settings → Credentials). Solve times, penalties and per-contest analysis are still derived from your submissions.',
      ];
    }

    return result;
  }
}
