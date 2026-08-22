/**
 * Real OAG flight identities, shaped into bookable Offers for the demo.
 *
 * OAG Flight Info returns SCHEDULES, not offers — real carriers, numbers, times
 * and terminals, but no fare and no seat inventory. So this attaches a
 * deterministic DEMO fare and seat count (clearly not a real quote — the real
 * booking-search at /api/search/flights still shows no price), plus the
 * `carriers` + `fareRules` the policy gate requires to consider an option at
 * all. Source is whatever `server/oag.ts` serves: recorded fixtures under
 * `OAG_REPLAY=1` (free, replayable forever), or a live trial call otherwise.
 *
 * Returns [] when there is no OAG data for the route/date (unrecorded fixture in
 * replay mode, or no keys), so the caller can fall back to the synthetic book —
 * the demo never ends up with nothing to rebook onto.
 */
import { flightInstancesByRoute } from '../oag';
import { airport, distanceKm } from '../airportDirectory';
import { hash, mulberry32 } from './mockFlights';
import type { Offer, SearchParams } from './types';

export async function oagOffers(params: SearchParams): Promise<Offer[]> {
  let instances;
  try {
    instances = await flightInstancesByRoute(params.origin, params.destination, params.departureDate);
  } catch {
    return []; // unrecorded fixture in replay mode, or a bad/absent key — fall back
  }

  const origin = airport(params.origin);
  const dest = airport(params.destination);
  if (!origin || !dest) return [];
  const km = distanceKm(origin, dest);

  const offers: Offer[] = [];
  for (const f of instances) {
    const departsAt = f.scheduledDepartureUtc ? Date.parse(f.scheduledDepartureUtc) : NaN;
    const arrivesAt = f.scheduledArrivalUtc ? Date.parse(f.scheduledArrivalUtc) : NaN;
    if (Number.isNaN(departsAt) || Number.isNaN(arrivesAt)) continue;

    const code = `${f.carrierIata} ${f.flightNumber}`;
    const rng = mulberry32(hash(`${code}${f.departureDate}`));
    const jitter = 0.85 + rng() * 0.3; // ±15% demo-fare variance, deterministic per flight
    const fareAmount = Math.round(Math.max(2500, km * 4.6 * jitter) / 10) * 10;
    const seatsRemaining = 1 + Math.floor(rng() * 9);
    const refundable = rng() > 0.4;

    offers.push({
      id: `oag:${params.origin}${params.destination}:${params.departureDate}:${code}`,
      supplier: 'travelport',
      supplierOfferId: `oag-${code}-${f.departureDate}`,
      flightCode: code,
      from: params.origin,
      to: params.destination,
      departsAt,
      arrivesAt,
      cabin: 'Economy', // OAG schedules do not carry cabin; the demo prices Economy
      seatsRemaining,
      price: { amount: fareAmount, currency: 'INR' },
      expiresAt: Date.now() + (12 + Math.floor(rng() * 18)) * 60_000,
      live: false,
      supplierType: 'coupon',
      carriers: { marketing: f.carrierIata, operating: f.carrierIata, validating: f.carrierIata },
      fareRules: {
        fareBasis: 'EDEMO',
        changeable: true,
        refundable,
        reissuePermitted: true,
        interlinePermitted: true,
        voidWindowMinutes: null,
      },
    });
  }

  return offers.sort((a, b) => a.departsAt - b.departsAt);
}
