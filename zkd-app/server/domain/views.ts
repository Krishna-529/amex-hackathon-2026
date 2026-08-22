/** Response-shaping helpers — turn domain entities into the API contract shapes in lib/apiTypes.ts. */
import * as store from './store';
import { refreshIfStale } from '../engine/forecast';
import { refreshAltsNow } from '../engine/altsCache';
import { altsForParty } from './altsForParty';
import { costFor } from './pricing';
import { estimateRefund } from './refund';
import { BILLING_CURRENCY } from '../myca';
import { getRate, convertWith, type Rate } from '../fx';
import type { Flight, Booking, Alt } from './types';
import type { FlightSummary, FlightDetail, DisruptionOpsView } from '@/lib/apiTypes';

async function travellerSummary(b: Booking) {
  const travellers = await store.getTravellersForBooking(b);
  return travellers.map((t, i) => ({
    id: t.id,
    displayName: t.displayName,
    type: t.type,
    seat: b.seats[i]?.seat ?? b.seat,
  }));
}

export async function toFlightSummary(
  flight: Flight,
  passengerId?: string,
  /** Already-fetched bookings for this flight. toFlightDetail needs them before
   *  it calls this, so passing them through avoids querying the same rows
   *  twice per detail request. Omit and they are fetched here as before. */
  knownBookings?: Booking[],
): Promise<FlightSummary> {
  // Kick a forecast refresh if it has aged out. Deliberately not awaited: a
  // device asking for a flight gets whatever we hold now, and the next poll
  // picks up the fresh number. Alternative-flight search is NOT kicked from
  // here any more — it is gated on the forecast's own risk band inside
  // refreshForecast/compute() (server/engine/forecast.ts), so a page view on
  // a low-risk flight never spends a supplier search it doesn't need.
  refreshIfStale(flight);
  // Independent reads, so they go together rather than one after the other.
  const [event, bookings] = await Promise.all([
    store.getDisruptionEvent(flight.id),
    knownBookings ? Promise.resolve(knownBookings) : store.getBookingsForFlight(flight.id),
  ]);
  const summary: FlightSummary = {
    id: flight.id, code: flight.code, from: flight.from, to: flight.to,
    depISO: flight.depISO, durationMin: flight.durationMin,
    aircraft: flight.aircraft, terminal: flight.terminal,
    forecast: flight.forecast,
    // Tickets, not PNRs — a single booking can cover a party of six.
    passengerCount: bookings.reduce((n, b) => n + store.partySize(b), 0),
    disruptionPhase: event?.phase ?? 'none',
  };
  if (passengerId) {
    const b = bookings.find((x) => x.passengerId === passengerId);
    if (b) {
      summary.booking = {
        id: b.id, seat: b.seat, pnr: b.pnr, cabin: b.cabin,
        partySize: store.partySize(b),
        travellers: await travellerSummary(b),
      };
    }
  }
  return summary;
}

/**
 * Drops rows that no live supplier could have quoted.
 *
 * This is not a business rule — it is a guard against our own history. Until
 * 2026-08-19 a function called `carrierProtectedAlt()` cloned the cheapest real
 * offer and overwrote it with `fare: 0, seats: 99` to stand for "the airline
 * owes you a seat". The function is gone and `AltKind` no longer has that
 * member, but `altsCache` only rewrites a flight's alts on refresh, so rows it
 * wrote sit in Postgres until something touches them. One survived on `f-multi`
 * — the flight the demo runs on — and rendered as a free option that also paid
 * the member back, because `altsForParty` reads `seats: 99` as "fits everyone"
 * and `fare: 0` as "costs nothing".
 *
 * The equivalent guards in server/pipeline/verify.ts were deleted along with
 * the kind, on the assumption that removing the writer was enough. It was not:
 * removing a writer does not remove what it wrote. This runs on the read path
 * so a stale row is inert wherever it came from.
 *
 * Matched on the signature rather than on `kind` alone, because rows exist that
 * predate the `kind` field — but a row is only dropped when it is impossible on
 * its face (free, or more seats than an aircraft has), never merely unusual.
 */
export function dropFabricatedAlts(alts: Alt[]): Alt[] {
  return alts.filter(
    (a) => a.kind !== ('carrier-protected' as Alt['kind']) && a.fare > 0 && a.seats < 99,
  );
}

export async function convertAltsToBillingCurrency(alts: Alt[]): Promise<Alt[]> {
  const target = BILLING_CURRENCY.toUpperCase();
  const foreignCurrencies = [...new Set(alts.map((a) => (a.currency || 'INR').toUpperCase()).filter((c) => c !== target))];
  if (foreignCurrencies.length === 0) return alts;

  const rates = new Map<string, Rate>();
  await Promise.all(
    foreignCurrencies.map(async (c) => {
      rates.set(c, await getRate(c, target));
    }),
  );

  return alts.map((alt) => {
    const cur = (alt.currency || 'INR').toUpperCase();
    if (cur === target) return alt;
    const rate = rates.get(cur);
    if (!rate || rate.source === 'identity') return alt;

    const originalAmount = alt.quoted ? alt.quoted.amount : alt.fare;
    const originalCurrency = alt.quoted ? alt.quoted.currency : alt.currency;
    const fare = convertWith(alt.fare, rate);

    return {
      ...alt,
      fare,
      currency: target,
      quoted: alt.quoted ?? {
        amount: originalAmount,
        currency: originalCurrency,
        rate: rate.rate,
        rateAsOf: rate.asOf,
        rateSource: rate.source,
      },
    };
  });
}

/**
 * `viewerPassengerId` is required, not optional: this is what makes the
 * response both party-aware (alts are projected through altsForParty for the
 * VIEWER's own party size) and privacy-correct (bookings is filtered to the
 * viewer's own row — without this, every co-passenger's name, seat and PNR
 * would be visible to anyone who could reach this flight's id).
 */
export async function toFlightDetail(flight: Flight, viewerPassengerId: string): Promise<FlightDetail> {
  const highRisk = flight.forecast && (flight.forecast.band !== 'watch' || (flight.forecast.riskScore ?? 0) >= 55);
  if (flight.candidates.alts.length === 0 && highRisk) {
    await refreshAltsNow(flight.id, 'auto-warm on high risk').catch(() => {});
    const updated = await store.getFlight(flight.id);
    if (updated) flight = updated;
  }
  const bookings = await store.getBookingsForFlight(flight.id);
  const own = bookings.find((b) => b.passengerId === viewerPassengerId);
  const partySize = own ? store.partySize(own) : 1;

  // The summary and the viewer's own name are independent of each other, and
  // the bookings above are handed down so toFlightSummary does not re-query
  // rows we are already holding.
  const [summary, ownPassenger] = await Promise.all([
    toFlightSummary(flight, viewerPassengerId, bookings),
    own ? store.getPassenger(own.passengerId) : Promise.resolve(undefined),
  ]);

  // What comes BACK if this flight dies. Computed once per detail request and
  // sent with the options, because the number a member decides on is not the
  // price of the replacement — it is the price minus what they get refunded.
  // `known: false` when we have no record of what they paid, and the UI must
  // render that as "unknown" rather than as zero.
  const refund = own
    ? estimateRefund({
        flight,
        booking: own,
        cancelledBy: 'carrier',
        // Absent a filed cancellation we assume the disruption is severe enough
        // to engage duty of care, which for a cancellation it is by definition.
        delayHours: 24,
        // Only stays tied to THIS flight can be unwound by its cancellation —
        // a hotel the member booked for a different trip is not a cancellation
        // charge this recovery caused.
        stays: (await store.getStaysForPassenger(viewerPassengerId).catch(() => []))
          .filter((s) => s.flightId === flight.id),
      })
    : null;

  // Order matters: drop what was never real, then convert what is left, then
  // project onto the viewer's party. Converting first would spend a rate
  // lookup on a fabricated row.
  const liveAlts = dropFabricatedAlts(flight.candidates.alts);
  const convertedAlts = await convertAltsToBillingCurrency(liveAlts);

  return {
    ...summary,
    candidates: {
      ...flight.candidates,
      alts: altsForParty(convertedAlts, partySize),
    },
    refund,
    connectionSlackMinutes: flight.connectionSlackMinutes,
    hasHardConstraint: flight.hasHardConstraint,
    hardDeadlineISO: flight.hardDeadlineISO ?? null,
    rescheduledToISO: flight.rescheduledToISO,
    forecastHistory: flight.forecastHistory ?? [],
    bookings: own
      ? [{ id: own.id, passengerId: own.passengerId, passengerName: ownPassenger?.displayName ?? own.passengerId, seat: own.seat, pnr: own.pnr, partySize }]
      : [],
  };
}

export async function toDisruptionOpsView(flightId: string): Promise<DisruptionOpsView | null> {
  const event = await store.getDisruptionEvent(flightId);
  const flight = await store.getFlight(flightId);
  if (!event || !flight) return null;
  const rawTasks = await store.getRecoveryTasksForFlight(flightId);
  const tasks = await Promise.all(rawTasks.map(async (t) => {
    const alt = flight.candidates.alts.find((a) => a.id === t.chosenAltId);
    return {
      passengerId: t.passengerId,
      passengerName: (await store.getPassenger(t.passengerId))?.displayName ?? t.passengerId,
      phase: t.phase,
      secondsLeft: t.phase === 'waiting' ? Math.max(0, Math.ceil((t.windowExpiresAt - Date.now()) / 1000)) : 0,
      partySize: t.partySize,
      chosenAltCode: alt?.code ?? null,
      owedNow: costFor(flight, t, t.partySize, BILLING_CURRENCY).total,
      resolution: t.resolution,
    };
  }));
  return { flightId, flightCode: flight.code, detectedAt: event.detectedAt, phase: event.phase, tasks };
}
