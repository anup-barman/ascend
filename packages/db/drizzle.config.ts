import { defineConfig } from 'drizzle-kit';

import { databasePath } from './src/paths';

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: databasePath(),
  },
  strict: true,
  verbose: true,
});
