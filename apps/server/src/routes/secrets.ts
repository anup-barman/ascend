import type { FastifyPluginAsync } from 'fastify';

import { secretNameSchema, secretValueSchema } from '../lib/schemas';
import { deleteSecret, describeSecrets, setSecret } from '../secrets';

/**
 * Credential routes (spec §63).
 *
 * Values are write-only over HTTP: they can be stored and deleted, and their
 * presence can be checked, but they are never read back — not even by the local
 * UI that submitted them. Nothing here is logged.
 */
export function secretsRoutes(): FastifyPluginAsync {
  return async (app) => {
    app.get('/api/secrets', async () => describeSecrets());

    app.put('/api/secrets/:name', async (request, reply) => {
      const name = secretNameSchema.parse(
        (request.params as { name?: string }).name ?? '',
      );
      const { value } = secretValueSchema.parse(request.body);

      setSecret(name, value);
      reply.code(204);
      return null;
    });

    app.delete('/api/secrets/:name', async (request, reply) => {
      const name = secretNameSchema.parse(
        (request.params as { name?: string }).name ?? '',
      );

      deleteSecret(name);
      reply.code(204);
      return null;
    });
  };
}
