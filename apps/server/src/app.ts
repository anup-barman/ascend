import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';

import {
  ensureProfile,
  getDatabase,
  InvalidTargetDateError,
  resetStaleSyncing,
  runMigrations,
  type AscendDb,
} from '@ascend/db';

import { config } from './config';
import { configRoutes } from './routes/config';
import { onboardingRoutes } from './routes/onboarding';
import { secretsRoutes } from './routes/secrets';
import { stateRoutes } from './routes/state';
import { syncRoutes } from './routes/sync';
import { SecretsUnavailableError } from './secrets';
import { SyncRunner } from './sync/runner';

export interface BuiltApp {
  app: FastifyInstance;
  db: AscendDb;
  /** Exposed so the smoke script can trigger a run and wait for it. */
  syncRunner: SyncRunner;
  close: () => Promise<void>;
}

function buildLogger() {
  if (config.isProduction) return { level: 'warn' };
  return {
    level: 'info',
    transport: {
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
    },
  };
}

/**
 * Fastify types the error-handler argument loosely, so `statusCode` is read
 * through a guard rather than assumed to exist.
 */
function statusCodeOf(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('statusCode' in error)) return undefined;
  const value = (error as { statusCode?: unknown }).statusCode;
  return typeof value === 'number' ? value : undefined;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'Request failed';
}

/**
 * Builds the Fastify application.
 *
 * Migrations run here rather than in a separate step so that simply starting
 * Ascend always leaves the database at the current schema — the app is a
 * personal tool, not a deployment with a release pipeline.
 */
export async function buildApp(): Promise<BuiltApp> {
  const opened = getDatabase();
  runMigrations(opened.db);
  ensureProfile(opened.db);
  // A previous run that was killed mid-sync would otherwise show SYNCING forever.
  resetStaleSyncing(opened.db);

  const app = Fastify({ logger: buildLogger() });
  const syncRunner = new SyncRunner(opened.db);

  // The Vite dev server runs on a different port; in production the SPA is
  // served from this origin and no cross-origin request happens at all.
  await app.register(cors, { origin: [config.devOrigin], credentials: true });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({
        error: 'validation_failed',
        message: 'The submitted values are not valid.',
        issues: error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      });
    }

    if (error instanceof InvalidTargetDateError) {
      return reply.code(400).send({ error: 'invalid_target_date', message: error.message });
    }

    // Actionable configuration problem, not a bug: tell the user how to fix it.
    if (error instanceof SecretsUnavailableError) {
      return reply.code(409).send({ error: 'secrets_unavailable', message: error.message });
    }

    if (typeof statusCodeOf(error) === 'number' && (statusCodeOf(error) ?? 500) < 500) {
      return reply
        .code(statusCodeOf(error) ?? 400)
        .send({ error: 'request_failed', message: messageOf(error) });
    }

    request.log.error({ err: error }, 'Unhandled server error');
    return reply.code(500).send({ error: 'internal_error', message: 'Something went wrong.' });
  });

  await app.register(stateRoutes(opened.db));
  await app.register(onboardingRoutes(opened.db));
  await app.register(configRoutes(opened.db));
  await app.register(secretsRoutes());
  await app.register(syncRoutes(opened.db, syncRunner));

  // Serve the built SPA when it exists, so `pnpm build && pnpm start` runs the
  // whole app as a single process.
  const webDist = fileURLToPath(new URL('../../web/dist', import.meta.url));
  if (existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api/')) {
        return reply.code(404).send({ error: 'not_found', message: `No route for ${request.url}` });
      }
      // Client-side routing: every other path renders the SPA shell.
      return reply.sendFile('index.html');
    });
  }

  return {
    app,
    db: opened.db,
    syncRunner,
    close: async () => {
      await app.close();
      // A run in flight holds the database open; let it finish its current write
      // rather than closing the connection out from under it.
      await syncRunner.settle();
      opened.close();
    },
  };
}
