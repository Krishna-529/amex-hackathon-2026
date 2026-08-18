/**
 * Deterministic, plain-language "top reason" for a prediction — always
 * present on every FlightForecast (server/domain/types.ts's TopReason),
 * regardless of whether the optional Gemini re-phrasing (app/api/explain)
 * is reachable. Pure, synchronous, zero I/O: this function cannot fail, so
 * a member can never be shown a blank "why" for a number that directly
 * affects whether we act on their behalf — see the trust/robustness
 * standard this whole feature was built against.
 */
import type { ModelExplanation, ModelScore } from './riskModel';
import type { TopReason } from '../domain/types';
import { FEATURE_LABEL } from '@/lib/featureLabels';

function fromExplanation(explanation: ModelExplanation): TopReason {
  // Defensive re-sort: zkd-risk-model/src/inference.py already returns
  // `features` sorted descending by |contribution|, but this function must
  // not silently trust that invariant holds forever across the process
  // boundary — one extra Math.abs sort costs nothing and removes a hidden
  // cross-repo coupling.
  const top = [...explanation.features].sort(
    (a, b) => Math.abs(b.contributionLogOdds) - Math.abs(a.contributionLogOdds),
  )[0];
  const label = FEATURE_LABEL[top.feature] ?? top.feature;
  const verb = top.direction === 'decreases' ? 'lowers' : 'raises';
  return {
    kind: 'model-shap',
    text: `Mainly driven by ${label.toLowerCase()} — this ${verb} the estimate the most of anything the model looked at.`,
    featureKey: top.feature,
  };
}

export function deriveTopReason(
  score: ModelScore,
  origin: string,
  fallbackExplanation?: ModelExplanation,
): TopReason {
  if (score.explanation?.features?.length) return fromExplanation(score.explanation);
  if (fallbackExplanation?.features?.length) return fromExplanation(fallbackExplanation);
  if (score.source === 'neighbor-smoothed') {
    return {
      kind: 'neighbor-context',
      text: `Nudged using current risk at other ${origin} departures around this time — not a fresh model run. Refresh for a full breakdown.`,
    };
  }
  return {
    kind: 'generic',
    text: "Based on this flight's carrier, route, and schedule history — refresh for the full factor breakdown.",
  };
}
