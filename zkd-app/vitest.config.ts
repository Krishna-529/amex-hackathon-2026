import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname, '.') },
  },
  test: {
    include: ['**/*.test.ts'],
    // tests/*.test.ts (bundle, outcome, policy, ranking, refreshCadence,
    // sandbox, smoke) are written for Node's built-in test runner
    // (`import { test } from 'node:test'`), not vitest — vitest's module
    // loader can resolve their `@/` imports so it happily loads and runs
    // them (every assertion inside genuinely passes, visible as real TAP
    // output), but it doesn't recognize node:test's registration style as
    // a vitest suite, so it reports each one as "No test suite found" —
    // 79 real passing assertions read as 7 failed files otherwise. Run
    // them with `node --experimental-strip-types --test tests/*.test.ts`
    // instead (needs a `@/` path-alias loader to match this project's
    // tsconfig — not yet wired into a dedicated npm script).
    exclude: ['node_modules', '.next', 'tests-e2e', 'tests'],
    environment: 'node',
  },
});
