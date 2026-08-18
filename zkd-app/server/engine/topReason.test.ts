import { describe, expect, it } from 'vitest';
import { deriveTopReason } from './topReason';
import type { ModelExplanation, ModelScore } from './riskModel';

/**
 * deriveTopReason is the trust-critical guarantee behind this feature: every
 * FlightForecast must carry a non-empty, plain-language reason, regardless
 * of whether a real SHAP explanation is available for this exact score. Pure
 * and synchronous — these tests assert properties (never empty, correctly
 * prioritizes the strongest branch available) rather than exact wording, so
 * copy can be retuned without breaking the suite.
 */
function explanationWith(features: Partial<ModelExplanation['features'][number]>[]): ModelExplanation {
  return {
    biasMarginLogOdds: -2,
    features: features.map((f, i) => ({
      feature: `feature_${i}`,
      value: 1,
      contributionLogOdds: 0,
      direction: 'increases',
      relativeShare: 0,
      ...f,
    })),
  };
}

const baseScore: ModelScore = {
  cancelProbability: 0.03,
  confidence: 0.8,
  modelVersion: 'test',
  source: 'internal-ml',
};

describe('deriveTopReason', () => {
  it('a real explanation on the score itself: picks the strongest-magnitude feature, not just the first one', () => {
    const explanation = explanationWith([
      { feature: 'weak_signal', contributionLogOdds: 0.1 },
      { feature: 'carrier_hist_cancel_rate', contributionLogOdds: -0.9, direction: 'decreases' },
      { feature: 'mid_signal', contributionLogOdds: 0.4 },
    ]);
    const reason = deriveTopReason({ ...baseScore, explanation }, 'BOM');
    expect(reason.kind).toBe('model-shap');
    expect(reason.featureKey).toBe('carrier_hist_cancel_rate');
    expect(reason.text.length).toBeGreaterThan(0);
    expect(reason.text.toLowerCase()).toContain('carrier');
  });

  it('no explanation on the score, but a carried-forward fallback exists: uses the fallback', () => {
    const fallback = explanationWith([{ feature: 'route_hist_cancel_rate', contributionLogOdds: 0.5 }]);
    const reason = deriveTopReason(baseScore, 'BOM', fallback);
    expect(reason.kind).toBe('model-shap');
    expect(reason.featureKey).toBe('route_hist_cancel_rate');
    expect(reason.text.length).toBeGreaterThan(0);
  });

  it('neighbor-smoothed score, no explanation anywhere: names the origin and says it is not a fresh model run', () => {
    const reason = deriveTopReason({ ...baseScore, source: 'neighbor-smoothed' }, 'BOM');
    expect(reason.kind).toBe('neighbor-context');
    expect(reason.featureKey).toBeUndefined();
    expect(reason.text).toContain('BOM');
    expect(reason.text.length).toBeGreaterThan(0);
  });

  it('real score, no explanation anywhere, not smoothed: a generic but honest fallback, never empty', () => {
    const reason = deriveTopReason(baseScore, 'BOM');
    expect(reason.kind).toBe('generic');
    expect(reason.featureKey).toBeUndefined();
    expect(reason.text.length).toBeGreaterThan(0);
  });

  it('an empty features array is treated the same as no explanation at all', () => {
    const reason = deriveTopReason({ ...baseScore, explanation: explanationWith([]) }, 'BOM');
    expect(reason.kind).toBe('generic');
  });

  it('property: text is always a non-empty string, across every branch', () => {
    const cases: [ModelScore, string, ModelExplanation | undefined][] = [
      [{ ...baseScore, explanation: explanationWith([{ feature: 'x', contributionLogOdds: 1 }]) }, 'DEL', undefined],
      [baseScore, 'DEL', explanationWith([{ feature: 'y', contributionLogOdds: -1 }])],
      [{ ...baseScore, source: 'neighbor-smoothed' }, 'DEL', undefined],
      [baseScore, 'DEL', undefined],
    ];
    for (const [score, origin, fallback] of cases) {
      const reason = deriveTopReason(score, origin, fallback);
      expect(typeof reason.text).toBe('string');
      expect(reason.text.length).toBeGreaterThan(0);
    }
  });
});
