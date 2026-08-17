import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname, '.') },
  },
  test: {
    include: ['**/*.test.ts'],
    // `tests/` is excluded because those files are written for Node's OWN test
    // runner (`import { test } from 'node:test'`), not vitest — they arrived
    // with the no-holds branch, which verified via `node
    // --experimental-strip-types`, while the rest of the suite is vitest from
    // Zayaan's branch. Vitest still matched them on `**/*.test.ts`, found no
    // vitest suite inside, and reported seven permanent failures that had
    // nothing to do with the code under test — which made `npm test` useless
    // as a gate.
    //
    // NOT FIXED HERE, and it should be: `node --test tests/` currently dies on
    // MODULE_NOT_FOUND because the `@/` alias has no resolver under node:test,
    // so these ~7 files are unrunnable by EITHER runner as committed. They need
    // porting to vitest (which already resolves `@/`, see resolve.alias above)
    // or a loader. Excluding them stops the noise; it does not restore the
    // coverage.
    exclude: ['node_modules', '.next', 'tests-e2e', 'tests/**'],
    environment: 'node',
  },
});
