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
    // Correction, via Zayaan's independent fix (debaf0e) which found this
    // first: vitest DOES load these files and their 79 assertions genuinely
    // run and pass — real TAP output, no failures. It simply does not
    // recognise node:test's registration style as a vitest suite, so it
    // reported 7 "No test suite found" failures over 79 passing assertions.
    // So the coverage is not lost, only unreported here.
    //
    // Still open: `node --test tests/` dies on MODULE_NOT_FOUND because the
    // `@/` alias has no resolver under node:test, so there is no npm script
    // that runs them and reports honestly. They need porting to vitest (which
    // already resolves `@/`, see resolve.alias above) or a path-alias loader.
    exclude: ['node_modules', '.next', 'tests-e2e', 'tests/**'],
    environment: 'node',
  },
});
