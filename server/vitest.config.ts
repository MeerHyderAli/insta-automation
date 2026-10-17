import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/unit/**/*.test.ts', 'test/api/**/*.test.ts'],
    coverage: { reporter: ['text', 'html'], include: ['src/**/*.ts'] },
    testTimeout: 15_000,
    hookTimeout: 15_000,
    restoreMocks: true,
  },
});
