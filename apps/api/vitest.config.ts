import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Each integration test file opens its own temporary SQLite file. Running files in
    // separate forks keeps that isolation honest and stops one suite's WAL from touching
    // another's.
    pool: 'forks',
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/testing/**', 'src/index.ts'],
    },
  },
});
