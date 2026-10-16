import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const pkg = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@ascend/core': pkg('./packages/core/src/index.ts'),
      '@ascend/db': pkg('./packages/db/src/index.ts'),
      '@ascend/providers': pkg('./packages/providers/src/index.ts'),
      '@ascend/llm': pkg('./packages/llm/src/index.ts'),
    },
  },
  test: {
    include: ['packages/*/src/**/*.test.ts', 'apps/*/src/**/*.test.ts'],
    environment: 'node',
    restoreMocks: true,
  },
});
