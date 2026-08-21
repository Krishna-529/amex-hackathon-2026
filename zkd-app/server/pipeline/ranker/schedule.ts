/**
 * Scheduled offline retraining for the alt-flight ranker — the local
 * equivalent of a periodic training job, mirroring
 * server/engine/batchScorer.ts's self-starting interval pattern exactly
 * (globalThis guard, self-rescheduling setTimeout, re-reads its interval
 * each tick).
 *
 * Added 2026-08-22. `train.ts`'s fit (`runTrainingPass`) previously had no
 * automatic trigger at all — it was a manual CLI script
 * (`node --experimental-strip-types server/pipeline/ranker/train.ts`) with
 * nothing in `instrumentation.ts` ever calling it. That meant
 * `weights.ts`'s `resolveWeights` chain was architecturally adaptive
 * (strategy prior -> MyCa warm start -> global learned -> member learned)
 * but operationally static: member choices accumulate in Postgres via
 * `decisionLog.ts` indefinitely with nothing ever learning from them. This
 * closes that loop.
 *
 * Cheap to run often: `runTrainingPass` reads the shown/choice logs and
 * resolved recovery tasks, and `buildObservations` returning `[]` (the case
 * with no new interaction data) means the per-strategy fit loop never runs
 * at all — no gradient descent, no writes. That's a different cost shape
 * from `batchScorer.ts`'s real per-tick supplier spend, so this ticks
 * immediately at startup as well as on its interval, rather than waiting
 * for the first scheduled tick the way a cost-bearing job would.
 *
 * After a promotion, calls `loadArtifact()` to force `weights.ts`'s
 * in-process cache to pick up the freshly-written model.json —
 * `getArtifact()` never re-reads the file on its own once cached, so
 * without this a promoted model would sit on disk unused by the very
 * process that just trained it, until the next restart.
 */
import { runTrainingPass } from './train.ts';
import { loadArtifact } from './weights.ts';

/** 30 minutes: frequent enough to be demo-visible, infrequent enough that a
 *  DB blip retries on the next tick rather than spamming it. Overridable for
 *  a live demo where you want to force a fast retrain cadence. */
const DEFAULT_INTERVAL_MS = 30 * 60 * 1000;

const g = globalThis as typeof globalThis & {
  __zkdRankerTrainerStarted?: boolean;
  __zkdRankerTrainerTimer?: NodeJS.Timeout;
};

/** Exported for tests: the env-var-override parsing, isolated from the timer
 *  machinery around it. */
export function intervalMs(): number {
  const raw = process.env.RANKER_RETRAIN_INTERVAL_MS;
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_INTERVAL_MS;
}

async function tick(): Promise<void> {
  const result = await runTrainingPass();
  if (result.promoted) {
    loadArtifact(); // force the serving cache to pick up what was just written
    const promotedStrategies = result.fits
      .filter((f) => f.promoted)
      .map((f) => `${f.strategy} (n=${f.n})`)
      .join(', ');
    console.log(`[ranker/schedule] promoted v${result.newVersion}: ${promotedStrategies}`);
  } else if (result.observations > 0) {
    console.log(
      `[ranker/schedule] ${result.observations} observations (${result.reconciledFromDb} reconciled, ` +
        `${result.directlyLogged} directly logged), nothing cleared its promotion bar this tick`,
    );
  }
  // observations === 0: nothing to say — this is the steady state until real
  // interaction data exists, and logging it every tick would be pure noise.
}

function scheduleNext(): void {
  g.__zkdRankerTrainerTimer = setTimeout(async () => {
    try {
      await tick();
    } catch (e) {
      console.error('[ranker/schedule] tick failed:', e);
    } finally {
      scheduleNext(); // re-read the interval each time so an env change takes effect on the next tick
    }
  }, intervalMs());
}

/**
 * Idempotent — safe to call from instrumentation.ts's register(), which
 * Next.js dev-mode HMR can re-invoke. The globalThis guard is what makes a
 * second call a no-op instead of two more competing timers.
 */
export function startRankerTrainer(): void {
  if (g.__zkdRankerTrainerStarted) return;
  g.__zkdRankerTrainerStarted = true;
  console.log(`[ranker/schedule] starting — retrain every ${intervalMs()}ms`);
  void tick().catch((e) => console.error('[ranker/schedule] startup tick failed:', e));
  scheduleNext();
}
