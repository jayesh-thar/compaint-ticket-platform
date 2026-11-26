import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    fileParallelism: false, // Sequential test files to prevent database truncation races
    testTimeout: 15000,
    hookTimeout: 15000,
  },
});
