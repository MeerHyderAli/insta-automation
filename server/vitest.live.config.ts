import { defineConfig } from 'vitest/config';

/**
 * Live Meta API tests. They require real credentials and are never part of the
 * default or CI test run. See test/live/meta.live.test.ts for the variables.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/live/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
