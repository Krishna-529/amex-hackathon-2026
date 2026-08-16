/**
 * The Makcorps affordability-guard threshold, isolated from server/hotels/
 * index.ts so it can be exercised directly by server/hotels/verify.ts without
 * dragging in the live provider clients (Duffel Stays, LiteAPI, Makcorps
 * itself) that index.ts and its registry pull in.
 *
 * Makcorps prices *arbitrary* future dates with no occupancy control (see
 * server/hotels/providers.ts marketContext) — a sample that happened to land
 * on a peak-season or holiday night can read several times more expensive than
 * tonight's real rate. A veto firing at the member's exact cap would then block
 * the whole search on a number that was never about tonight in the first
 * place: the agent would refuse to even look, when a live source might have
 * answered affordably. This guard exists to catch genuinely implausible
 * situations — a five-figure cap against a six-figure market — not to
 * fine-tune a budget. Fine-grained budgeting is what a real, dated quote is
 * for.
 */
export const MAKCORPS_VETO_TOLERANCE = 3;

export function marketExceedsTolerance(
  median: number,
  sampleCurrency: string,
  cap: { amount: number; currency: string },
): boolean {
  // Compared in the cap's own currency. marketContext is asked for that
  // currency, so if it answered in another we cannot compare and must not
  // block — the same refusal to guess an FX rate the rest of the repo makes.
  if (sampleCurrency !== cap.currency) return false;
  return median > cap.amount * MAKCORPS_VETO_TOLERANCE;
}
