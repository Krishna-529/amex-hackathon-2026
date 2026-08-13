/**
 * `Flight.candidates.alts` is shared by every booking on the flight, but
 * whether an alternative actually works depends on the party sitting in that
 * booking — a 3-seat alt is fine for a couple and useless for a family of six.
 * This is the pure function that reconciles the two, called once per viewer
 * with their own party size, never persisted onto the Flight itself.
 */
import type { Alt } from './types';

export type PartyAlt = Alt & {
  /** whether this alternative can seat the whole party, independent of policy */
  fitsParty: boolean;
  /** total for the whole party, in this alt's currency (0 for carrier-protected) */
  partyFare: number;
};

export function altsForParty(alts: Alt[], partySize: number): PartyAlt[] {
  return alts.map((alt) => {
    if (alt.kind === 'carrier-protected') {
      // Owed under DGCA CAR Section 3 / EU261 Art. 8 to every ticket on the
      // PNR — the carrier does not get to say "only 3 of your 6 fit".
      return {
        ...alt,
        fitsParty: true,
        partyFare: 0,
        ok: alt.ok,
        why: partySize > 1
          ? `The airline cancelled, so it owes re-accommodation for all ${partySize} tickets on this booking — this is owed, not bought.`
          : alt.why,
      };
    }

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
