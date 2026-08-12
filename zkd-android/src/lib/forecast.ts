/**
 * The Android build is a subset of the web app and has no backend of its own —
 * no fetch calls anywhere. So where the web app reads a live forecast from the
 * disruption-prediction vendor, this carries the same three demo fixtures the
 * web mock uses, in the same shape.
 *
 * What it deliberately does NOT do is re-derive a probability from invented
 * factor weights. The number is bought, not computed, and this build says so
 * rather than showing five bars it made up.
 */

export type Band = 'watch' | 'prepare' | 'hold-gate' | 'pre-authorise';

export type Forecast = {
  pct: number;
  band: Band;
  /** the threshold this flight would have to cross for us to ask in advance */
  askEarlyAt: number;
  source: 'lumo' | 'mock';
};

const FIXTURES: Record<string, { pct: number; askEarlyAt: number }> = {
  'AI 2803': { pct: 83, askEarlyAt: 63 },
  'AI 2201': { pct: 9, askEarlyAt: 72 },
  '6E 5192': { pct: 21, askEarlyAt: 80 },
};

export function forecastFor(flightCode: string): Forecast | null {
  const f = FIXTURES[flightCode];
  if (!f) return null;
  return { pct: f.pct, band: bandOf(f.pct, f.askEarlyAt), askEarlyAt: f.askEarlyAt, source: 'mock' };
}

function bandOf(pct: number, askEarlyAt: number): Band {
  if (pct >= askEarlyAt) return 'pre-authorise';
  if (pct >= askEarlyAt * 0.68) return 'hold-gate';
  if (pct >= askEarlyAt * 0.31) return 'prepare';
  return 'watch';
}

/** UI tone buckets, kept to three so the existing colour classes still apply. */
export const BAND_TONE: Record<Band, 'low' | 'mid' | 'high'> = {
  watch: 'low',
  prepare: 'mid',
  'hold-gate': 'high',
  'pre-authorise': 'high',
};

export const BAND_LABEL: Record<Band, string> = {
  watch: 'Low risk',
  prepare: 'Moderate risk',
  'hold-gate': 'High risk',
  'pre-authorise': 'Very high risk',
};

export const BAND_SAY: Record<Band, string> = {
  watch: "Nothing unusual around this flight. We'll keep watching it and only tell you if that changes.",
  prepare:
    "A few things are working against this one. We're already lining up alternatives in the background.",
  'hold-gate':
    "This flight is in real trouble. We've got backup seats identified and we'll move you the moment it's called.",
  'pre-authorise':
    "This one looks likely to go. Tell us now what you'd want and we won't need to ask you in a hurry later.",
};
