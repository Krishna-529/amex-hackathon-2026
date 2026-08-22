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

/** A negative or non-finite seat count is real-world supplier noise, not a
 *  meaningful "no seats" signal — but it's still safe to fold into "no
 *  seats", never into a positive number we'd have to invent. */
function sanitizeSeats(seats: number): number {
  return Number.isFinite(seats) && seats >= 0 ? Math.floor(seats) : 0;
}

/**
 * Same signature `server/domain/views.ts`'s `dropFabricatedAlts` matches —
 * `kind !== 'market'` (the type system no longer even allows anything else,
 * see `AltKind`, so this only ever catches a stale pre-2026-08-19 DB row) or
 * the specific fare:0/seats:99 shape the deleted `carrierProtectedAlt()`
 * writer used to stamp.
 *
 * Duplicated here rather than imported from views.ts because THAT function
 * only runs on the member-facing READ path. Every live decision-making call
 * site — `pipeline/index.ts`, `simulation.ts`, the intent route — calls
 * `altsForParty` directly on raw stored data and never went through
 * `dropFabricatedAlts` at all. A stale fabricated row only survives in
 * Postgres if it's PINNED to an unresolved recovery
 * (`altsCache.ts`'s `mergePinned`) — which is exactly the highest-risk case:
 * a free-looking fabricated row that's the CURRENTLY CHOSEN option for an
 * in-flight recovery would be invisible to the member's screen
 * (`dropFabricatedAlts` hides it there) while still being what the live
 * pipeline could act on. Fixed 2026-08-21 by making this the one place
 * every consumer — display and decision alike — passes through.
 */
function looksFabricated(alt: Alt): boolean {
  return (alt.kind as string) !== 'market' || (alt.fare === 0 && alt.seats >= 99);
}

export function altsForParty(alts: Alt[], partySize: number): PartyAlt[] {
  return alts.map((rawAlt) => {
    // Defend against a malformed supplier row before it reaches anywhere
    // that does arithmetic on `fare`/`seats` — pricing.ts, refund.ts, and
    // the ranker's featuriser all trust these are real numbers. Seats is
    // safe to coerce toward "none" (0 is already the honest floor of "no
    // seats"). Fare is NOT safe to coerce toward 0 — this codebase spent a
    // real incident (see memory.md, 2026-08-19) removing a fabricated
    // `fare: 0` row precisely because a free-looking option can win every
    // price comparison and get auto-booked. A NaN/negative fare is
    // therefore disqualified outright, with an honest reason, rather than
    // silently priced at zero.
    const seats = sanitizeSeats(rawAlt.seats);
    const fareValid = Number.isFinite(rawAlt.fare) && rawAlt.fare >= 0;
    const alt: Alt = { ...rawAlt, seats };

    const fitsParty = seats >= partySize;
    const partyFare = fareValid ? alt.fare * partySize : 0;

    if (looksFabricated(alt)) {
      return {
        ...alt,
        fitsParty,
        partyFare,
        ok: false,
        why: `Stale or fabricated inventory data — not shown as bookable.`,
      };
    }

    if (!fareValid) {
      return {
        ...alt,
        fitsParty,
        partyFare,
        ok: false,
        why: `Price data from this source was invalid — not shown as bookable.`,
      };
    }

    if (!fitsParty) {
      return {
        ...alt,
        fitsParty,
        partyFare,
        ok: false,
        why: `${seats} seat${seats === 1 ? '' : 's'} left and you are ${partySize} — we will not split your party across flights.`,
      };
    }

    return { ...alt, fitsParty, partyFare, ok: alt.ok, why: alt.why };
  });
}
