import { databasePath } from '@ascend/db';

import { buildApp } from './app';
import { config } from './config';

/** Entry point. Binds to loopback only (spec §2, §63). */
async function main(): Promise<void> {
  const { app, close } = await buildApp();

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info(`Received ${signal}, shutting down`);
    await close();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  try {
    await app.listen({ port: config.port, host: config.host });
    app.log.info(`Ascend database: ${databasePath()}`);
  } catch (error) {
    app.log.error({ err: error }, 'Failed to start');
    await close();
    process.exit(1);
  }
}

void main();
