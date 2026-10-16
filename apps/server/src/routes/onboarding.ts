import type { FastifyPluginAsync } from 'fastify';

import {
  ensureProfile,
  markOnboarded,
  setActiveTargetEvent,
  setAvailability,
  updateProfile,
  updateSettings,
  upsertPlatformAccount,
  type AscendDb,
} from '@ascend/db';

import { onboardingSchema } from '../lib/schemas';
import { buildAppState } from '../lib/state';

/**
 * Onboarding (spec §8).
 *
 * Applied as a single transaction so a half-configured install is impossible.
 * The target event is optional — §3 forbids inventing a date, so finishing
 * onboarding without one is legitimate and the dashboard says so plainly.
 */
export function onboardingRoutes(db: AscendDb): FastifyPluginAsync {
  return async (app) => {
    app.post('/api/onboarding', async (request) => {
      const input = onboardingSchema.parse(request.body);

      db.transaction(() => {
        ensureProfile(db);

        if (input.profile) {
          updateProfile(db, {
            displayName: input.profile.displayName ?? null,
            teamName: input.profile.teamName ?? null,
          });
        }

        if (input.handles.codeforces) {
          upsertPlatformAccount(db, 'codeforces', input.handles.codeforces);
          // Gym shares the Codeforces identity (§1).
          upsertPlatformAccount(db, 'codeforces_gym', input.handles.codeforces);
        }
        if (input.handles.atcoder) {
          upsertPlatformAccount(db, 'atcoder', input.handles.atcoder);
        }

        if (input.targetEvent) {
          setActiveTargetEvent(db, {
            name: input.targetEvent.name,
            date: input.targetEvent.date,
            location: input.targetEvent.location ?? null,
            notes: input.targetEvent.notes ?? null,
          });
        }

        if (input.availability) setAvailability(db, input.availability);
        if (input.training) updateSettings(db, { training: input.training });

        markOnboarded(db);
      });

      return buildAppState(db);
    });
  };
}
