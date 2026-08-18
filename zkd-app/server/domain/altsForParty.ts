/**
 * `Flight.candidates.alts` is shared by every booking on the flight, but
 * whether an alternative actually works depends on the party sitting in that
 * booking — a 3-seat alt is fine for a couple and useless for a family of six.
 * This is the pure function that reconciles the two, called once per viewer
 * with their own party size, never persisted onto the Flight itself.
 *
 * The `carrier-protected` branch that used to sit at the top of this map is
 * gone with the kind itself (2026-08-19). It claimed a fabricated option could
 * always seat the whole party at zero fare — true of a real statutory
 * re-accommodation, and meaningless for a row we invented from a market offer.
 * Every alt now goes through the same honest seat check.
 */
import type { Alt } from './types';

export type PartyAlt = Alt & {
  /** whether this alternative can seat the whole party, independent of policy */
  fitsParty: boolean;
  /** total for the whole party, in this alt's currency */
  partyFare: number;
};

export function altsForParty(alts: Alt[], partySize: number): PartyAlt[] {
  return alts.map((alt) => {
    const fitsParty = alt.seats >= partySize;
    const partyFare = alt.fare * partySize;

    if (!fitsParty) {
      return {
        ...alt,
        fitsParty,
        partyFare,
        ok: false,
        why: `${alt.seats} seat${alt.seats === 1 ? '' : 's'} left and you are ${partySize} — we will not split your party across flights.`,
      };
    }

    return { ...alt, fitsParty, partyFare, ok: alt.ok, why: alt.why };
  });
}
