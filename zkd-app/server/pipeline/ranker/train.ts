/**
 * The offline trainer. Runs OUT of the request path — never during a recovery —
 * reads the shown-set + choice logs, fits a conditional-logit weight vector per
 * strategy, and writes a new model.json. Same cadence and shape as the weekly
 * risk-model retrain: a job, an artifact, a metrics line.
 *
 * The maths is a maximum-likelihood conditional logit with three anti-overfit
 * controls stacked on top, because a learned ranker in a spend path has to be
 * conservative by construction, not by luck:
 *
 *   1. L2 TO PRIOR. The loss is  NLL(w) + lambda * ||w - prior||^2 . The penalty
 *      pulls every coefficient the data does not strongly support back toward the
 *      hand-set/MyCa prior. This is ridge regression recentred on the prior — the
 *      continuous form of "only move as far as the evidence justifies".
 *
 *   2. MONOTONE PROJECTION. After every gradient step, weights on the oriented
 *      features are clipped to >= 0. So no correlation in thin data can ever
 *      produce a model that ranks a pricier or later flight above a cheaper or
 *      earlier one, all else equal. The guarantee survives training.
 *
 *   3. HELD-OUT PROMOTION. The fitted vector is only written if it beats the
 *      incumbent (the current artifact's effective weights) on the log-likelihood
 *      of a held-out slice of decisions. A fit that does not out-predict what we
 *      already ship does not ship. This is the offline, no-live-experiment
 *      counterpart to an A/B test.
 *
 * The count shrinkage and the hard minData gate live in weights.ts and apply at
 * SERVE time on top of whatever this writes, so even a promoted vector is blended
 * toward the prior until its strategy has real volume behind it.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { FEATURES, type FeatureVector, type WeightVector, type RankerArtifact } from './types.ts';
import { bookabilityOffset } from './bookability.ts';

/** One presented choice set with the option the member actually took. */
export type Observation = {
  strategy: string;
  memberId?: string;
  /** per-candidate features, aligned with `bookability` and `chosenIndex` */
  candidates: { features: FeatureVector; bookability: number }[];
  chosenIndex: number;
};

const ARTIFACT_PATH = join(process.cwd(), 'server', 'pipeline', 'ranker', 'model.json');

// ── likelihood ──────────────────────────────────────────────────────────────

function utilities(obs: Observation, w: WeightVector, art: RankerArtifact): number[] {
  return obs.candidates.map((c) => {
    let v = bookabilityOffset(c.bookability, art);
    for (const f of FEATURES) v += w[f] * c.features[f];
    return v;
  });
}

function softmax(v: number[]): number[] {
  const m = Math.max(...v);
  const e = v.map((x) => Math.exp(x - m));
  const z = e.reduce((a, b) => a + b, 0) || 1;
  return e.map((x) => x / z);
}

/** Mean negative log-likelihood over a set of observations, for a given w. */
export function negLogLik(obs: Observation[], w: WeightVector, art: RankerArtifact): number {
  if (obs.length === 0) return 0;
  let nll = 0;
  for (const o of obs) {
    const p = softmax(utilities(o, w, art));
    nll += -Math.log(Math.max(1e-12, p[o.chosenIndex]));
  }
  return nll / obs.length;
}

/** Gradient of [mean NLL + L2-to-prior] w.r.t. w. */
function gradient(
  obs: Observation[],
  w: WeightVector,
  prior: WeightVector,
  lambda: number,
  art: RankerArtifact,
): WeightVector {
  const g = {} as WeightVector;
  for (const f of FEATURES) g[f] = 0;

  for (const o of obs) {
    const p = softmax(utilities(o, w, art));
    // E_p[phi] - phi_chosen, summed per feature
    for (const f of FEATURES) {
      let expected = 0;
      for (let j = 0; j < o.candidates.length; j++) expected += p[j] * o.candidates[j].features[f];
      g[f] += expected - o.candidates[o.chosenIndex].features[f];
    }
  }
  for (const f of FEATURES) {
    g[f] = g[f] / Math.max(1, obs.length) + 2 * lambda * (w[f] - prior[f]);
  }
  return g;
}

// ── fit ───────────────────────────────────────────────────────────────────

export type FitOptions = {
  lambda: number;
  monotone: Set<string>;
  lr?: number;
  steps?: number;
};

/**
 * Projected gradient descent from the prior. Starting AT the prior (not at zero)
 * means the L2 term is zero at init and the fit only moves under real gradient
 * pressure from data — a warm start that is itself an anti-overfit choice.
 */
export function fitConditionalLogit(
  obs: Observation[],
  prior: WeightVector,
  art: RankerArtifact,
  opts: FitOptions,
): WeightVector {
  const lr = opts.lr ?? 0.3;
  const steps = opts.steps ?? 400;
  let w: WeightVector = { ...prior };

  for (let t = 0; t < steps; t++) {
    const g = gradient(obs, w, prior, opts.lambda, art);
    const next = {} as WeightVector;
    for (const f of FEATURES) {
      let v = w[f] - lr * g[f];
      if (opts.monotone.has(f)) v = Math.max(0, v); // projection = the monotonicity guarantee
      next[f] = v;
    }
    w = next;
  }
  return w;
}

/** Deterministic 70/30 split by a stable hash of the observation, so promotion
 *  is evaluated on data the fit never saw. */
export function splitHeldOut(obs: Observation[], frac = 0.3): { train: Observation[]; test: Observation[] } {
  const train: Observation[] = [];
  const test: Observation[] = [];
  obs.forEach((o, i) => {
    // simple, stable, dependency-free hash
    const h = (i * 2654435761) % 100;
    (h < frac * 100 ? test : train).push(o);
  });
  return { train, test };
}

/** The effective incumbent weights for a strategy: what serve-time would use at
 *  high count — the learned-or-prior blend, without the per-member layer. */
function incumbentWeights(art: RankerArtifact, strategy: string): WeightVector {
  return art.learnedByStrategy[strategy] ?? art.priorByStrategy[strategy] ?? art.priorByStrategy.earliest_arrival;
}

export type StrategyFit = {
  strategy: string;
  n: number;
  weights: WeightVector;
  heldOutNllChallenger: number;
  heldOutNllIncumbent: number;
  promoted: boolean;
};

/** Fit one strategy and decide whether it may replace the incumbent. */
export function fitStrategy(art: RankerArtifact, strategy: string, obs: Observation[]): StrategyFit {
  const prior = art.priorByStrategy[strategy] ?? art.priorByStrategy.earliest_arrival;
  const mono = new Set(art.monotoneNonNegative);
  const { train, test } = splitHeldOut(obs);

  const challenger = fitConditionalLogit(train, prior, art, { lambda: art.shrink.l2ToPrior, monotone: mono });
  const incumbent = incumbentWeights(art, strategy);

  const nllC = negLogLik(test, challenger, art);
  const nllI = negLogLik(test, incumbent, art);
  const promoted = obs.length >= art.shrink.minDataGlobal && nllC < nllI;

  return { strategy, n: obs.length, weights: challenger, heldOutNllChallenger: nllC, heldOutNllIncumbent: nllI, promoted };
}

// ── bookability from revalidation outcomes ───────────────────────────────────

export type RevalOutcome = { supplier: string; bookable: boolean };

/** Fold observed revalidation outcomes into per-supplier bookability rates. The
 *  serve-time shrinkage in bookability.ts pulls these toward the tier prior by
 *  count, so a handful of observations cannot swing a supplier's rate. */
export function learnBookability(outcomes: RevalOutcome[]): Record<string, { p: number; n: number }> {
  const agg: Record<string, { ok: number; n: number }> = {};
  for (const o of outcomes) {
    (agg[o.supplier] ??= { ok: 0, n: 0 });
    agg[o.supplier].n += 1;
    if (o.bookable) agg[o.supplier].ok += 1;
  }
  const out: Record<string, { p: number; n: number }> = {};
  for (const [s, a] of Object.entries(agg)) out[s] = { p: a.ok / a.n, n: a.n };
  return out;
}

// ── artifact I/O ─────────────────────────────────────────────────────────────

export function loadArtifactFrom(path = ARTIFACT_PATH): RankerArtifact {
  return JSON.parse(readFileSync(path, 'utf8')) as RankerArtifact;
}

/** Apply promoted fits + learned bookability to an artifact, bumping version. */
export function updateArtifact(
  art: RankerArtifact,
  fits: StrategyFit[],
  bookability: Record<string, { p: number; n: number }>,
): RankerArtifact {
  const next: RankerArtifact = JSON.parse(JSON.stringify(art));
  next.version = art.version + 1;
  next.trainedAt = new Date().toISOString();
  for (const f of fits) {
    if (f.promoted) {
      next.learnedByStrategy[f.strategy] = f.weights;
      next.counts.byStrategy[f.strategy] = f.n;
    }
  }
  if (Object.keys(bookability).length) {
    next.bookability.learnedBySupplier = { ...next.bookability.learnedBySupplier, ...bookability };
  }
  return next;
}

// ── main: read logs, fit, write ──────────────────────────────────────────────

function readJsonl<T>(path: string): T[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as T);
}

/** Reconstruct observations by joining shown-sets to choices on decisionId. */
export function buildObservations(
  shown: { decisionId: string; strategy: string; memberId: string; candidates: { altId: string; features: FeatureVector; bookability: number }[] }[],
  choices: { decisionId: string; chosenAltId: string }[],
): Observation[] {
  const choiceById = new Map(choices.map((c) => [c.decisionId, c.chosenAltId]));
  const obs: Observation[] = [];
  for (const s of shown) {
    const chosenAltId = choiceById.get(s.decisionId);
    if (!chosenAltId) continue; // no recorded choice → not yet a training pair
    const idx = s.candidates.findIndex((c) => c.altId === chosenAltId);
    if (idx < 0) continue; // chosen option not in the logged set (should not happen)
    obs.push({
      strategy: s.strategy,
      memberId: s.memberId,
      candidates: s.candidates.map((c) => ({ features: c.features, bookability: c.bookability })),
      chosenIndex: idx,
    });
  }
  return obs;
}

// Run directly: `node --experimental-strip-types server/pipeline/ranker/train.ts`
if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}` || process.argv[1]?.endsWith('train.ts')) {
  const art = loadArtifactFrom();
  const shownDir = join(process.cwd(), 'server', '.state');
  const shown = readJsonl<any>(join(shownDir, 'ranker-shown.jsonl'));
  const choices = readJsonl<any>(join(shownDir, 'ranker-choices.jsonl'));
  const obs = buildObservations(shown, choices);

  const byStrategy = new Map<string, Observation[]>();
  for (const o of obs) (byStrategy.get(o.strategy) ?? byStrategy.set(o.strategy, []).get(o.strategy)!).push(o);

  const fits: StrategyFit[] = [];
  for (const [strategy, os] of byStrategy) fits.push(fitStrategy(art, strategy, os));

  console.log(`observations: ${obs.length}`);
  for (const f of fits) {
    console.log(
      `  ${f.strategy}: n=${f.n} held-out NLL ${f.heldOutNllChallenger.toFixed(4)} vs incumbent ${f.heldOutNllIncumbent.toFixed(4)} → ${f.promoted ? 'PROMOTE' : 'keep prior'}`,
    );
  }

  if (fits.some((f) => f.promoted)) {
    const next = updateArtifact(art, fits, {});
    writeFileSync(ARTIFACT_PATH, JSON.stringify(next, null, 2) + '\n');
    console.log(`wrote model.json v${next.version}`);
  } else {
    console.log('no promotion — model.json unchanged');
  }
}
