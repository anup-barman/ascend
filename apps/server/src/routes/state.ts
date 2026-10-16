import type { FastifyPluginAsync } from 'fastify';

import type { AscendDb } from '@ascend/db';

import { buildAppState } from '../lib/state';

/**
 * Bootstrap and liveness routes.
 *
 * `GET /api/state` is the shell's single source of truth: countdown, phase,
 * configuration and sync status in one round trip.
 */
export function stateRoutes(db: AscendDb): FastifyPluginAsync {
  return async (app) => {
    app.get('/api/health', async () => ({
      ok: true,
      app: 'ascend',
      version: '0.1.0',
    }));

    app.get('/api/state', async () => buildAppState(db));
  };
}
