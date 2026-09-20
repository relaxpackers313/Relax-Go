import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      // Tests run against shared SOURCE so a stale dist can never hide a break.
      '@relaxgo/shared': path.resolve(__dirname, '../../packages/shared/src/index.ts'),
    },
  },
  test: {
    setupFiles: ['./src/tests/setup.ts'],
    hookTimeout: 120_000,
    testTimeout: 60_000,
    pool: 'forks',
  },
});
