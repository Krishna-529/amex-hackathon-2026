/**
 * Shared types for the learned alternate-flight ranker.
 *
 * This whole directory replaces the hand-set weighted sum that used to live
 * inside server/pipeline/score.ts's `score()`. It does not replace, move, or
 * change anything else in the pipeline: it is handed a list of alternatives
 * that have ALREADY passed `applyHardRules` (so every candidate is bookable-
 * in-policy, entitled, party-fitting and deadline-meeting), and it returns them
 * ranked. Everything upstream (search, compose, hard rules) and downstream
 * (the saga, the journal, the member UI) is untouched.
 */

export const FEATURES = ['arrival', 'cost', 'cabin', 'effort', 'loyalty', 'redeye', 'seats', 'stability'] as const;
export type FeatureName = (typeof FEATURES)[number];

/** A candidate expressed as its raw, signed "goodness" features (higher = more preferred). */
export type FeatureVector = Record<FeatureName, number>;

export type WeightVector = Record<FeatureName, number>;

/** The persisted artifact shape. train.ts writes it; weights.ts reads it. */
export type RankerArtifact = {
  version: number;
  trainedAt: string;
  note?: string;
  features: readonly string[];
  featureDoc?: Record<string, string>;
  scales: FeatureVector;
  monotoneNonNegative: FeatureName[];
  priorByStrategy: Record<string, WeightVector>;
  mycaOffsets: {
    loyaltyIfPreferredCarriers: number;
    redeyeIfAvoid: number;
    cabinIfPremiumEntitled: number;
    note?: string;
  };
  bookability: {
    logFloor: number;
    priors: { liveWithExpiry: number; okNoExpiry: number; other: number };
    learnedBySupplier: Record<string, { p: number; n: number }>;
    shrink: { pseudoCount: number };
    note?: string;
  };
  shrink: {
    pseudoCountGlobal: number;
    pseudoCountMember: number;
    minDataGlobal: number;
    minDataMember: number;
    l2ToPrior: number;
    note?: string;
  };
  explore: { epsilon: number; nearTieDelta: number; note?: string };
  learnedByStrategy: Record<string, WeightVector>;
  learnedByMember: Record<string, WeightVector>;
  counts: { byStrategy: Record<string, number>; byMember: Record<string, number> };
};

/** One candidate after the model has scored it. */
export type ModelScored = {
  altId: string;
  /** the linear utility plus the bookability offset — the value ranking sorts on */
  utility: number;
  /** softmax probability of being chosen from this exact set, for logging + explanation */
  choiceProbability: number;
  /** P(bookable) that entered the utility as an offset */
  bookability: number;
  /** raw features, kept for display and for the decision log's join key */
  features: FeatureVector;
  /** per-feature contribution w_k * phi_k, so the explanation can lead with the true reason */
  contributions: FeatureVector;
  /** display rank after any near-tie exploration; 0 = shown first */
  rank: number;
  /** probability THIS ranking placement was produced, for unbiased offline evaluation */
  propensity: number;
};
