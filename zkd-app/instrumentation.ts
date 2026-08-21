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

    // Resumes every pipeline run a PREVIOUS process's death would otherwise
    // have discarded — pipelineRuns is an in-memory Map for the hot path
    // (see server/domain/store.ts's header on why it isn't fully async),
    // but is now mirrored to Postgres on every write; this reads that
    // mirror back before anything else can observe an empty Map that
    // should have real in-flight pipeline runs in it. Must run before the
    // reconciliation sweep below, which can itself touch pipeline state.
    const { hydratePipelineRunsFromDb } = await import('./server/domain/store');
    await hydratePipelineRunsFromDb();

    const { startBatchScorer } = await import('./server/engine/batchScorer');
    startBatchScorer();

    // Asking whether the thing we predicted actually happened. Until this
    // existed, the only way a cancellation ever reached the system was a human
    // pressing a button on /ops — the AviationStack lookup and the classifier
    // were both built and had no callers. Self-disables and says so when
    // AVIATIONSTACK_API_KEY is unset or its small monthly allowance is spent.
    const { startStatusPoller } = await import('./server/engine/statusPoller');
    startStatusPoller();

    // Registers per-flight push subscriptions, so a carrier's own feed tells us
    // about a cancellation in seconds instead of us paying to ask every five
    // minutes. Inert and loudly so while WEBHOOK_PUBLIC_URL is unset — the
    // receiver still works and is testable locally, nothing is registered, and
    // the poller above stays primary.
    const { startSubscriptionSync } = await import('./server/webhooks/subscriptions');
    startSubscriptionSync();

    // Warms the AppConfig-backed threshold cache before the first real
    // request needs it (no-op when THRESHOLD_CONFIG_URL is unset, e.g.
    // local dev) — getThresholdConfig() also self-refreshes lazily on every
    // call, this just avoids the first request paying that latency.
    const { refreshThresholdConfigIfStale } = await import('./lib/thresholdConfig');
    refreshThresholdConfigIfStale();

    // Resumes any consent window a PREVIOUS process's death abandoned
    // mid-flight, then keeps sweeping for the same case periodically — see
    // server/engine/simulation.ts's reconcileStrandedTasks() for why this
    // exists: the consent-window timer lives only in process memory, so
    // without this, a routine restart permanently strands every member with
    // an open window at the moment of that restart.
    const { startReconciliationSweep } = await import('./server/engine/simulation');
    startReconciliationSweep();
  }
}
