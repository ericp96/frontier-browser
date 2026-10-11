import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts'],
          exclude: ['**/*.integration.test.ts', '**/*.e2e.test.ts', '**/node_modules/**'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'integration',
          include: ['packages/*/test/**/*.integration.test.ts', 'apps/*/test/**/*.integration.test.ts'],
          testTimeout: 30000,
          hookTimeout: 30000,
          fileParallelism: false,
        },
      },
      {
        test: {
          name: 'electron',
          include: ['apps/desktop/test/**/*.e2e.test.ts'],
          testTimeout: 30000,
          hookTimeout: 60000,
          fileParallelism: false,
        },
      },
    ],
  },
});
