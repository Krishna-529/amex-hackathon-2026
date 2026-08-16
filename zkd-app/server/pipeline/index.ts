/**
 * The rebooking pipeline's public surface — the only module
 * server/engine/simulation.ts imports.
 *
 * ── Where the authority boundary sits ──────────────────────────────────────
 *
 * Canon separates planning from execution and puts the WAIT gate between them.
 * That boundary is drawn inside this module, and drawn hard:
 *
 *   `onDisruptionDetected` runs TRIGGERED → SEARCHING → EVALUATING →
 *   HOLD_PENDING and then **stops**. Everything it does is reversible:
 *   searches, scores, and holds that lapse free. It never spends.
 *
 *   `execute` is the only function that crosses. It is never called by the
 *   pipeline itself — the consent decision belongs to simulation.ts, which
 *   already owns the confirmation window, the consent tiers, and the rule that
 *   silence plus a cost means stop. Duplicating that judgement here would give
 *   the system two places to decide whether to spend a member's money, which is
 *   one too many.
 *
 * ── Nothing here may throw at its caller ───────────────────────────────────
 *
 * `detectDisruption` is synchronous and its return value is the response body
 * for POST /api/disruptions. An exception escaping the pipeline would take the
 * trigger endpoint down with it, so every entry point below is either
 * `void`-called with an internal catch, or returns a value on failure. This is
 * the highest-severity failure mode in the design and it is handled by
 * construction rather than by care.
 */

import * as store from '../domain/store';
import { fetchProfile, DEFAULT_PER_TRANSACTION_CAP } from '../myca';
import { altsForParty } from '../domain/altsForParty';
import { refreshAltsNow } from '../engine/altsCache';
import { searchAccommodation, applyHotelRules, toHotelOpt, affordabilityVeto } from '../hotels';
import { searchGround, withinGroundCap, toCabOpt } from '../ground';
import { airport } from '../airportDirectory';
import { adapt, type AdaptedPreferences } from '../preferences/adapt';
import * as journal from './journal';
import { applyHardRules, rankAlts, type ScoreContext } from './score';
import { composeConnections, needsOvernight, needsRentalCar } from './compose';
import { runSaga } from './saga';
import { narrate } from './narrate';
import { MAX_REPLANS, type PipelineRun } from './types';
import type { DisruptionResolution, Flight, RecoveryTask } from '../domain/types';

export { snapshot, ensureRun, transition } from './journal';
export type { PipelineSnapshot } from './journal';
export * from './types';

/**
 * Until a real preference document is stored per member, every member gets the
 * schema's own defaults layered over the MyCa mock. Kept in one place so
 * swapping in a real store is a single change.
 */
function defaultWirePreferences(memberCarriers: string[], homeAirport: string) {
  return {
    traveler_identity: {
      full_legal_name: '', date_of_birth: '', gender: 'UNSPECIFIED' as const,
      nationality: 'IN', home_airport_code: homeAirport,
    },
    contact_and_notifications: {
      primary_phone: '', primary_email: '', preferred_alert_channels: ['push' as const],
    },
    loyalty_programs: { airlines: memberCarriers.map((c) => ({ airline_code: c })) },
    flight_preferences: { preferred_cabin: 'economy' as const, max_acceptable_layovers: 1 },
    ground_transport_preferences: {},
    autonomous_rebooking_rules: {
      optimization_strategy: 'earliest_arrival' as const,
      auto_approve_rebooking: true,
      hotel_trigger_threshold_hours: 6,
      rental_car_trigger_threshold_hours: 24,
    },
  };
}

/**
 * Rich hotel offers from the pipeline's own search, kept alongside the UI-shaped
 * `HotelOpt` rows written onto the flight.
 *
 * `Flight.candidates.hotels` is deliberately the display shape — it is polled
 * every few seconds and has no business carrying rate handles and cancellation
 * timelines. But the saga needs those to take a real reversible hold, so they
 * are retained here, keyed by run and then by the same id the UI uses. Absence
 * is meaningful and handled: it means "known by id only", not "broken".
 */
const hotelOffersByRun = new Map<string, Map<string, import('../hotels').HotelOffer>>();

async function preferencesFor(passengerId: string): Promise<AdaptedPreferences> {
  const profile = await fetchProfile(passengerId);
  const wire = defaultWirePreferences(
    profile.preferences.preferredCarriers,
    profile.cardMember.nationality === 'Indian' ? 'MAA' : '',
  );
  const adapted = adapt(wire, profile.payment.billingCurrency);
  // MyCa remains the system of record for entitlement and cap — a preference
  // document must never be able to raise its own ceiling.
  adapted.preferences.cabinEntitlement = profile.preferences.cabinEntitlement;
  adapted.preferences.perTransactionCap = profile.preferences.perTransactionCap;
  adapted.rules.outOfPocketCap = profile.preferences.perTransactionCap;
  return adapted;
}

// ── Entry point ────────────────────────────────────────────────────────────

/**
 * "A disruption was detected on this flight."
 *
 * Synchronous and never throws, because `detectDisruption` calls it inline. The
 * actual work is fire-and-forget: the recovery advances on its own schedule
 * whether or not anyone is polling, which is the same design simulation.ts
 * already documents for its own timers.
 */
export function onDisruptionDetected(flightId: string): void {
  try {
    const bookings = store.getBookingsForFlight(flightId);
    for (const booking of bookings) {
      const run = journal.ensureRun(flightId, booking.passengerId);
      // Idempotent by construction: a redelivered webhook or a repeated poll
      // finds the run already past TRIGGERED and leaves it alone.
      if (run.state !== 'TRIGGERED') continue;

      journal.append(run, {
        kind: 'triggered',
        detail: { flightId, passengerId: booking.passengerId, partySize: store.partySize(booking) },
      });

      void plan(run).catch((err) => {
        halt(run, `pipeline error: ${err instanceof Error ? err.message : String(err)}`);
      });
    }
  } catch (err) {
    // Swallowed deliberately — see the module header. The trigger endpoint must
    // survive anything that happens in here.
    console.error('[pipeline] onDisruptionDetected failed:', err);
  }
}

/** SEARCHING → EVALUATING → HOLD_PENDING, then parks at the WAIT gate. */
async function plan(run: PipelineRun): Promise<void> {
  const flight = store.getFlight(run.flightId);
  const booking = store.getBookingsForFlight(run.flightId).find((b) => b.passengerId === run.passengerId);
  if (!flight || !booking) return halt(run, 'flight or booking vanished mid-recovery');

  if (!journal.transition(run, 'SEARCHING', 'assembling the option portfolio').ok) return;

  const prefs = await preferencesFor(run.passengerId);
  const partySize = store.partySize(booking);

  // Force a confirm-lane refresh: a disruption is exactly the moment staleness
  // is unacceptable at any price, and this is what the reserve exists for.
  await refreshAltsNow(run.flightId, 'disruption detected').catch(() => {});

  const directCount = flight.candidates.alts.filter((a) => a.ok).length;
  const connections = await composeConnections(
    flight,
    directCount,
    partySize,
    prefs.rules,
    prefs.preferences.cabinEntitlement,
    prefs.preferences.perTransactionCap,
  ).catch(() => ({ alts: [], hubsTried: [], callsSpent: 0 }));

  if (connections.alts.length > 0) {
    const existing = new Set(flight.candidates.alts.map((a) => a.id));
    flight.candidates.alts = [
      ...flight.candidates.alts,
      ...connections.alts.filter((a) => !existing.has(a.id)),
    ];
  }

  journal.append(run, {
    kind: 'search',
    detail: {
      directs: directCount,
      connections: connections.alts.length,
      hubsTried: connections.hubsTried.join(',') || 'none',
      extraCalls: connections.callsSpent,
    },
  });

  if (!journal.transition(run, 'EVALUATING', 'scoring the portfolio against the member profile').ok) return;

  const ctx: ScoreContext = {
    flight,
    rules: prefs.rules,
    preferredCabin: prefs.preferredCabin,
    partySize,
    cap: prefs.preferences.perTransactionCap,
    preferredCarriers: prefs.preferences.preferredCarriers,
    hasHardConstraint: flight.hasHardConstraint,
  };

  const party = altsForParty(flight.candidates.alts, partySize);
  const { kept, removed } = applyHardRules(party, ctx);

  if (removed.length > 0) {
    journal.append(run, {
      kind: 'filtered',
      detail: { removed: removed.length, rules: removed.map((r) => `${r.code}: ${r.rule}`).join(' | ') },
    });
  }

  if (kept.length === 0) {
    // "We found nothing" and "your own settings excluded everything" are
    // different answers, and the member is owed the second one.
    const reason = removed.length > 0
      ? `Every alternative we found was excluded by your own settings — ${removed[0].rule}. Nothing was booked; this one is yours to decide.`
      : 'No alternative we can see gets you there. Nothing was booked and nothing was charged.';
    return halt(run, reason);
  }

  const ranked = rankAlts(kept, ctx);
  const best = ranked[0];

  journal.append(run, {
    kind: 'ranked',
    detail: {
      strategy: prefs.rules.strategy,
      considered: ranked.length,
      chosen: best.alt.code,
      score: best.score.total,
      why: best.why,
    },
  });

  // Overnight and ground are only assembled when the member is actually
  // stranded long enough to need them — composing a hotel for a 19:00 same-day
  // departure would be selling a room nobody needs.
  let hotelId = '';
  let cabId = '';
  if (needsOvernight(flight, best.alt, prefs.rules)) {
    const arranged = await arrangeOvernight(run, flight, prefs, partySize).catch(() => null);
    if (arranged) {
      hotelId = arranged.hotelId;
      cabId = arranged.cabId;
    }
  }

  if (needsRentalCar(flight, best.alt, prefs.rules)) {
    journal.append(run, {
      kind: 'error',
      detail: {
        note: 'a multi-day rental is indicated by your settings, but no rental provider is wired — falling back to a transfer',
        thresholdHours: prefs.rules.rentalCarTriggerHours,
      },
    });
  }

  run.plan = { altId: best.alt.id, hotelId, cabId };
  journal.transition(run, 'HOLD_PENDING', 'holding the top option while the member decides');
}

/**
 * Populates hotel and ground candidates for an overnight recovery.
 *
 * The Makcorps affordability guard runs only when no live source answered — it
 * can withhold, never approve, and may not override a real price.
 */
async function arrangeOvernight(
  run: PipelineRun,
  flight: Flight,
  prefs: AdaptedPreferences,
  partySize: number,
): Promise<{ hotelId: string; cabId: string } | null> {
  const ap = airport(flight.from);
  if (!ap) return null;

  const checkin = flight.depISO.slice(0, 10);
  const checkout = new Date(new Date(checkin).getTime() + 86_400_000).toISOString().slice(0, 10);
  const rooms = Math.ceil(partySize / 2);

  const [rooms_, ground] = await Promise.all([
    searchAccommodation({
      iata: ap.iata,
      cityName: ap.city,
      countryCode: ap.country.slice(0, 2).toUpperCase(),
      checkin,
      checkout,
      rooms,
      adults: partySize,
      currency: prefs.preferences.perTransactionCap.currency,
      guestNationality: 'IN',
      lane: 'confirm',
    }),
    searchGround(
      {
        fromLat: ap.lat, fromLon: ap.lon, toLat: ap.lat, toLon: ap.lon,
        seatsNeeded: partySize,
        currency: prefs.preferences.perTransactionCap.currency,
        lane: 'confirm',
      },
      prefs.ground,
    ),
  ]);

  const eligible = applyHotelRules(rooms_.offers, prefs.hotel);
  journal.append(run, {
    kind: 'composed',
    detail: {
      hotelsFound: rooms_.offers.length,
      hotelsEligible: eligible.length,
      groundFound: ground.offers.length,
      sources: JSON.stringify({ ...rooms_.sources, ...ground.sources }),
    },
  });

  if (eligible.length === 0) {
    const veto = await affordabilityVeto(ap.city, prefs.rules.outOfPocketCap).catch(() => null);
    if (veto) journal.append(run, { kind: 'halt', detail: { reason: veto, source: 'market-context-guard' } });
    return null;
  }

  const cabs = withinGroundCap(ground.offers, prefs.rules.groundCap);
  flight.candidates.hotels = eligible.map((h) => toHotelOpt(h));
  flight.candidates.cabs = cabs.map(toCabOpt);

  // Keep the rich offers so the saga can take a real hold against a rate id
  // rather than committing to a room by name alone.
  hotelOffersByRun.set(run.id, new Map(eligible.map((h) => [h.id, h])));

  return {
    hotelId: flight.candidates.hotels[0]?.id ?? '',
    cabId: flight.candidates.cabs[0]?.id ?? '',
  };
}

// ── Read surface for simulation.ts ─────────────────────────────────────────

/**
 * The plan the pipeline would choose, read synchronously.
 *
 * Must stay synchronous: `createTaskForBooking` runs inside a `setTimeout`
 * callback and cannot await, which is the same constraint that forced
 * DEFAULT_PER_TRANSACTION_CAP to exist as a sync export. Returns null when the
 * search has not finished, and the caller falls back to its own heuristic — so
 * the demo never stalls waiting on a supplier.
 */
export function preferredPlan(
  flightId: string,
  passengerId: string,
): { altId: string; hotelId: string; cabId: string } | null {
  const run = store.getPipelineRun(flightId, passengerId);
  return run?.plan ?? null;
}

/** The pipeline summary that rides inside RecoveryView — no extra client poll. */
export function summaryFor(flightId: string, passengerId: string) {
  const run = store.getPipelineRun(flightId, passengerId);
  if (!run) return null;
  return {
    state: run.state,
    replans: run.replans,
    orphans: run.orphans.length,
    mutationsEnabled: run.mutationsEnabled,
    strategy: run.journal.find((e) => e.kind === 'ranked')?.detail.strategy ?? null,
    why: run.journal.find((e) => e.kind === 'ranked')?.detail.why ?? null,
    timings: journal.timings(run),
  };
}

// ── Crossing the gate ──────────────────────────────────────────────────────

/**
 * Runs the saga. The only irreversible thing in this module.
 *
 * Called once consent exists — either explicitly, or by the rules simulation.ts
 * already owns (autopilot, or ask-me-first where the recovery costs nothing).
 * This function does not re-derive any of that; it is told, and it acts.
 */
export async function execute(task: RecoveryTask, resolution: DisruptionResolution): Promise<void> {
  const run = journal.ensureRun(task.flightId, task.passengerId);
  const flight = store.getFlight(task.flightId);
  const booking = store.getBooking(task.bookingId);
  if (!flight || !booking) return void halt(run, 'flight or booking vanished before execution');

  const alt = flight.candidates.alts.find((a) => a.id === task.chosenAltId);
  if (!alt) return void halt(run, 'the chosen option is no longer in the candidate list');

  // The room the member is holding, if any. `flight.candidates.hotels` carries
  // the UI shape; the richer HotelOffer only exists when the pipeline's own
  // search produced it, so it is looked up separately and may legitimately be
  // absent (seeded fixtures, or a choice made before the search finished).
  const chosenHotelOpt = flight.candidates.hotels.find((h) => h.id === task.chosenHotelId);
  const hotel = chosenHotelOpt
    ? {
        id: chosenHotelOpt.id,
        name: chosenHotelOpt.name,
        offer: hotelOffersByRun.get(run.id)?.get(chosenHotelOpt.id) ?? null,
      }
    : null;

  const cab = flight.candidates.cabs.find((c) => c.id === task.chosenCabId) ?? null;

  if (!journal.transition(run, 'CONFIRMED', `consent recorded: ${resolution.kind}`).ok) return;

  const outcome = await runSaga({
    run,
    flight,
    booking,
    alt,
    hotel,
    cabKind: cab?.kind ?? null,
    hasOnwardLeg: store.getNextLeg(booking.id) !== null,
    narrate: (step) =>
      narrate(step, {
        flight,
        task,
        booking,
        cap: DEFAULT_PER_TRANSACTION_CAP,
        intentOnly: !run.mutationsEnabled,
      }),
  });

  const fresh = store.getRecoveryTask(task.flightId, task.passengerId);
  if (!fresh) return;

  if (outcome.state === 'CONFIRMED') {
    fresh.phase = 'booked';
    if (outcome.note) fresh.note = outcome.note;
  } else {
    fresh.phase = 'handed';
    fresh.note = outcome.note;
    // The run already transitioned to CONFIRMED to cross the gate; a saga that
    // rolled back does not get to move backwards (there is no such edge), so
    // the failure is recorded on the task and in the journal instead.
    journal.append(run, { kind: 'halt', detail: { reason: outcome.note, rolledBack: outcome.rolledBack.length } });
  }
  store.setRecoveryTask(fresh);
}

/** Abandon before the gate. Everything left of it lapses free, so this only has to stop. */
export function abort(flightId: string, passengerId: string, reason: string): void {
  const run = store.getPipelineRun(flightId, passengerId);
  if (run) halt(run, reason);
}

function halt(run: PipelineRun, reason: string): void {
  if (run.state === 'CONFIRMED' || run.state === 'FAILED_FALLBACK') return;
  journal.append(run, { kind: 'halt', detail: { reason } });
  journal.transition(run, 'FAILED_FALLBACK', reason);
}

/** Bounded re-plan, for the /replan route. */
export async function replan(flightId: string, passengerId: string): Promise<boolean> {
  const run = store.getPipelineRun(flightId, passengerId);
  if (!run || run.state !== 'HOLD_PENDING') return false;
  if (run.replans >= MAX_REPLANS) {
    journal.append(run, { kind: 'error', detail: { note: 're-plan limit reached', limit: MAX_REPLANS } });
    return false;
  }
  run.replans += 1;
  if (!journal.transition(run, 'SEARCHING', 'member asked for a fresher set').ok) return false;
  await plan(run).catch((err) => halt(run, `re-plan failed: ${err}`));
  return true;
}
