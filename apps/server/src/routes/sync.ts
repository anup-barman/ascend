import type { FastifyPluginAsync } from 'fastify';

import { getSyncSummary, type AscendDb } from '@ascend/db';

import type { SyncRunner } from '../sync/runner';
import type { SyncEvent } from '../sync/engine';

/**
 * Sync trigger and status (spec §7).
 *
 * `POST /api/sync` returns immediately with 202: a full run spends minutes inside
 * the Codeforces rate limit, so the request that starts it cannot wait for it.
 * Progress arrives on `GET /api/sync/events`, and `GET /api/sync/status` is the
 * pull equivalent for a client that would rather poll or that missed the stream.
 */

/** Keeps an idle stream from being reaped, and proves the server is still there. */
const HEARTBEAT_MS = 25_000;

function writeEvent(
  write: (chunk: string) => void,
  event: 'sync' | 'ready',
  payload: unknown,
): void {
  write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
}

export function syncRoutes(db: AscendDb, runner: SyncRunner): FastifyPluginAsync {
  return async (app) => {
    app.get('/api/sync/status', async () => ({
      ...getSyncSummary(db),
      run: runner.state,
    }));

    app.post('/api/sync', async (_request, reply) => {
      const started = runner.start();
      if (!started.started) {
        return reply
          .code(409)
          .send({ error: 'sync_already_running', message: 'A sync is already in progress.' });
      }
      return reply.code(202).send({ started: true, sync: getSyncSummary(db), run: runner.state });
    });

    app.get('/api/sync/events', async (request, reply) => {
      // This response is written by hand for as long as the client stays
      // connected, so Fastify must stop managing it.
      reply.hijack();
      reply.raw.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
      });

      let open = true;
      const write = (chunk: string): void => {
        if (open) reply.raw.write(chunk);
      };

      // The first frame carries the current state, so a client that connects
      // between runs renders the real status instead of an empty panel.
      writeEvent(write, 'ready', { summary: getSyncSummary(db), run: runner.state });

      const unsubscribe = runner.subscribe((event: SyncEvent) => {
        writeEvent(write, 'sync', event);
      });
      const heartbeat = setInterval(() => write(': ping\n\n'), HEARTBEAT_MS);

      const close = (): void => {
        if (!open) return;
        open = false;
        clearInterval(heartbeat);
        unsubscribe();
        reply.raw.end();
      };

      request.raw.on('close', close);
      request.raw.on('error', close);
    });
  };
}
