import type { FastifyPluginAsync } from 'fastify';

import {
  clearActiveTargetEvent,
  getActiveTargetEvent,
  getAvailability,
  getPlatformAccounts,
  getSettings,
  removePlatformAccount,
  setActiveTargetEvent,
  setAvailability,
  updateProfile,
  updateSettings,
  upsertPlatformAccount,
  type AscendDb,
} from '@ascend/db';

import {
  availabilitySchema,
  handlesSchema,
  profileSchema,
  settingsPatchSchema,
  targetEventSchema,
} from '../lib/schemas';
import { buildAppState } from '../lib/state';

/** Configuration routes: profile, handles, target event, availability, settings (§64). */
export function configRoutes(db: AscendDb): FastifyPluginAsync {
  return async (app) => {
    // --- Profile ---------------------------------------------------------
    app.patch('/api/profile', async (request) => {
      const patch = profileSchema.parse(request.body);
      return updateProfile(db, {
        ...(patch.displayName !== undefined ? { displayName: patch.displayName ?? null } : {}),
        ...(patch.teamName !== undefined ? { teamName: patch.teamName ?? null } : {}),
      });
    });

    // --- Platform handles (§1) -------------------------------------------
    app.get('/api/handles', async () => ({ accounts: getPlatformAccounts(db) }));

    app.put('/api/handles', async (request) => {
      const body = handlesSchema.parse(request.body);

      if (body.codeforces !== undefined) {
        if (body.codeforces === null) removePlatformAccount(db, 'codeforces');
        else upsertPlatformAccount(db, 'codeforces', body.codeforces);
      }
      if (body.atcoder !== undefined) {
        if (body.atcoder === null) removePlatformAccount(db, 'atcoder');
        else upsertPlatformAccount(db, 'atcoder', body.atcoder);
      }

      return { accounts: getPlatformAccounts(db) };
    });

    // --- Target event (§3) -----------------------------------------------
    app.get('/api/target-event', async () => ({ targetEvent: getActiveTargetEvent(db) }));

    app.put('/api/target-event', async (request) => {
      const body = targetEventSchema.parse(request.body);
      const targetEvent = setActiveTargetEvent(db, {
        name: body.name,
        date: body.date,
        location: body.location ?? null,
        notes: body.notes ?? null,
      });
      return { targetEvent, state: buildAppState(db) };
    });

    /** Returns the app to its honest "no target configured" state. */
    app.delete('/api/target-event', async () => {
      clearActiveTargetEvent(db);
      return { targetEvent: null, state: buildAppState(db) };
    });

    // --- Availability (§53) ----------------------------------------------
    app.get('/api/availability', async () => ({ minutes: getAvailability(db) }));

    app.put('/api/availability', async (request) => {
      const body = availabilitySchema.parse(request.body);
      return { minutes: setAvailability(db, body.minutes) };
    });

    // --- Settings (§64) ---------------------------------------------------
    app.get('/api/settings', async () => getSettings(db));

    app.patch('/api/settings', async (request) => {
      const patch = settingsPatchSchema.parse(request.body);
      return updateSettings(db, patch);
    });
  };
}
