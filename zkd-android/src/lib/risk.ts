/**
 * Cancellation risk. Weight × severity per factor, summed.
 * Nothing here is stored — change a signal and the number moves.
 */

export type Signals = {
  weather: number;
  rotation: number;
  congestion: number;
  record: number;
  slot: number;
};

export type Band = 'low' | 'mid' | 'high';

type Factor = {
  id: keyof Signals;
  name: string;
  w: number;
  say: (v: number) => string;
};

export const FACTORS: Factor[] = [
  {
    id: 'weather',
    name: 'Weather at departure and arrival',
    w: 34,
    say: (v) =>
      v > 0.6
        ? 'Thunderstorms forecast around your slot'
        : v > 0.35
          ? 'Cloud and some rain expected'
          : 'Clear conditions both ends',
  },
  {
    id: 'rotation',
    name: "Your aircraft's inbound flight",
    w: 26,
    say: (v) =>
      v > 0.6
        ? 'The aircraft flying you is already late upstream'
        : v > 0.35
          ? 'Inbound running slightly behind'
          : 'Aircraft is on schedule and in position',
  },
  {
    id: 'congestion',
    name: 'Airport congestion at your slot',
    w: 18,
    say: (v) =>
      v > 0.6
        ? 'Peak bank — heavy departure queue'
        : v > 0.35
          ? 'Moderately busy departure window'
          : 'Quiet departure window',
  },
  {
    id: 'record',
    name: "This route's cancellation record",
    w: 14,
    say: (v) =>
      v > 0.6
        ? 'This route cancels often in this season'
        : v > 0.35
          ? 'Occasional cancellations on this route'
          : 'This route rarely cancels',
  },
  {
    id: 'slot',
    name: 'Time of day',
    w: 8,
    say: (v) =>
      v > 0.6
        ? 'Late evening — delays have stacked all day'
        : v > 0.35
          ? 'Afternoon, some knock-on delay'
          : 'Early departure, before delays build',
  },
];

export const bandOf = (v: number): Band => (v > 0.6 ? 'high' : v > 0.35 ? 'mid' : 'low');

export function risk(signals: Signals) {
  let total = 0;
  const parts = FACTORS.map((f) => {
    const v = signals[f.id];
    const pts = f.w * v;
    total += pts;
    return { ...f, v, pts: +pts.toFixed(1), note: f.say(v) };
  });
  const pct = Math.round(Math.min(96, total));
  return { pct, parts, band: (pct >= 55 ? 'high' : pct >= 25 ? 'mid' : 'low') as Band };
}

export const BAND_LABEL: Record<Band, string> = {
  low: 'Low risk',
  mid: 'Moderate risk',
  high: 'High risk',
};

export const BAND_SAY: Record<Band, string> = {
  low: "Nothing unusual around this flight. We'll keep watching it and only tell you if that changes.",
  mid: "A few things are working against this one. We're already lining up alternatives in the background.",
  high: "This flight is in real trouble. We've got backup seats identified and we'll move you the moment it's called.",
};

export const GLOW: Record<Band, string> = {
  low: 'rgba(75,171,124,.10)',
  mid: 'rgba(211,160,63,.10)',
  high: 'rgba(217,97,90,.12)',
};
