import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname, '.') },
  },
  test: {
    include: ['**/*.test.ts'],
    exclude: ['node_modules', '.next', 'tests-e2e'],
    environment: 'node',
    // Default 5s is too tight under full-suite parallel load on a loaded dev
    // machine (module transform/import contention, not slow test logic —
    // every test here passes in well under 1s in isolation).
    testTimeout: 15000,
  },
});
