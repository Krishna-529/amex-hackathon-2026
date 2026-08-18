/**
 * Minimal extract from the source branch's pipeline/types.ts — just the one
 * type server/pipeline/score.ts needs. That branch's full file also defines a
 * whole separate journal/saga/PipelineState system this repo does not port
 * (see the implementation plan) — pulling in the rest here would reintroduce
 * exactly what was deliberately left behind.
 */
import type { OptimizationStrategy } from '../preferences/schema';

export type OptionScore = {
  /** 0-1, higher is better */
  total: number;
  parts: { arrival: number; cost: number; reliability: number; cabin: number; loyalty: number; effort: number };
  weights: { arrival: number; cost: number; reliability: number; cabin: number; loyalty: number; effort: number };
  /** the strategy that produced these weights, so a ranking can be replayed */
  strategy: OptimizationStrategy;
  /** one line per component, for the explanation the member reads */
  notes: string[];
  /** ADDITIVE — not on the source branch's original type. The strongest-
   *  contributing criterion (parts[k]*weights[k], descending, [0]) — lets
   *  server/domain/types.ts's OptionReason carry this without duplicating
   *  score.ts's private explain() logic. */
  leadingCriterion: 'arrival' | 'cost' | 'reliability' | 'cabin' | 'loyalty' | 'effort';
};
