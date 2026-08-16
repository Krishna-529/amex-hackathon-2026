/**
 * Next.js server-startup hook (stable since Next 15, no config flag needed).
 * This is the one place code runs exactly once when the server process
 * starts — as opposed to route handlers, which only run per-request — so
 * it's where the interval batch re-scorer (server/engine/batchScorer.ts)
 * has to live. Without it, forecast history would only ever grow from
 * page-view-triggered refreshes, not a real independent interval.
 */
export async function register() {
  // Next's build-time static-generation workers also bootstrap the Next.js
  // runtime (and therefore call this hook) once per worker — without this
  // guard, `npm run build` was opening a real Postgres connection per worker
  // (harmless, since runMigrations() is idempotent) AND starting the batch
  // scorer's real setInterval inside a short-lived build process, which is
  // simply wrong: nothing should be on a recurring timer during a build.
  // NEXT_PHASE is set by Next.js itself, not something this app sets.
  if (process.env.NEXT_PHASE === 'phase-production-build') return;

  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Best-effort: applies any pending migrations before the batch scorer's
    // first tick, so the first real request doesn't pay that latency. Every
    // store.ts call also lazily awaits this same memoized promise, so a
    // failure here isn't fatal to the process — it just means the first
    // request does the migration check instead.
    const { ensureReady } = await import('./server/domain/db');
    await ensureReady().catch((e) => console.error('[db] migration check failed at startup:', e));

    const { startBatchScorer } = await import('./server/engine/batchScorer');
    startBatchScorer();

    // Warms the AppConfig-backed threshold cache before the first real
    // request needs it (no-op when THRESHOLD_CONFIG_URL is unset, e.g.
    // local dev) — getThresholdConfig() also self-refreshes lazily on every
    // call, this just avoids the first request paying that latency.
    const { refreshThresholdConfigIfStale } = await import('./lib/thresholdConfig');
    refreshThresholdConfigIfStale();
  }
}
