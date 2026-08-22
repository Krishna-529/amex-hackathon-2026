/**
 * "Tell us what you'd prefer" — free text in, a real re-search out.
 *
 * **This route now DRIVES the recovery.** It reads the member's sentence, turns
 * it into a validated preference override, **persists it as per-flight session
 * state** (`store.setSessionPrefs`), and **re-runs the pipeline** — a fresh
 * supplier search, connection composition, hotel + ground re-compose, and
 * ranking — all against those preferences (`planForPreferences` → `plan()`). The
 * portfolio the member then sees, and the plan that would be pre-authed/booked,
 * both reflect what they asked for. Earlier this route applied nothing and only
 * re-ranked the already-cached alternatives; that was a preview, and the member
 * asked for a real re-book.
 *
 * What is deliberately preserved is the one invariant that actually matters:
 * the override is scoped to THIS flight+passenger recovery and is discarded with
 * it. It is **never** merged into the durable MyCa profile — one sentence about
 * one flight must not rewrite a member's standing preferences. And nothing
 * irreversible happens here: `plan()` stays entirely left of the WAIT gate, so a
 * misread costs a re-search, never a booking. DELETE clears the override and
 * re-plans on the member's plain MyCa preferences — the "Undo".
 */
import { NextRequest, NextResponse } from 'next/server';
import * as store from '@/server/domain/store';
import { requireSession } from '@/server/auth/guard';
import { parseJsonBody, isNonEmptyString } from '@/server/jsonBody';
import { fetchProfile, BILLING_CURRENCY } from '@/server/myca';
import { adapt, type AdaptedPreferences } from '@/server/preferences/adapt';
import { readIntent, applyOverride, type IntentContext } from '@/server/preferences/intent';
import { altsForParty } from '@/server/domain/altsForParty';
import { applyHardRules, rankAlts, type ScoreContext } from '@/server/pipeline/score';
import { planForPreferences, preferredPlan } from '@/server/pipeline';
import { logMemberIntent } from '@/server/decisionLedger';
import type { Flight } from '@/server/domain/types';

type IntentBody = { text: string };

function isIntentBody(v: unknown): v is IntentBody {
  return typeof v === 'object' && v !== null && isNonEmptyString((v as { text?: unknown }).text);
}

/** The member's plain MyCa-derived preferences (no override). Shared by the model
 *  context and by the base re-rank the DELETE path uses. */
async function basePreferencesFor(passengerId: string) {
  const profile = await fetchProfile(passengerId);
  const base = adapt(
    {
      traveler_identity: {
        full_legal_name: '', date_of_birth: '', gender: 'UNSPECIFIED',
        nationality: 'IN', home_airport_code: '',
      },
      contact_and_notifications: {
        primary_phone: '', primary_email: '', preferred_alert_channels: ['push'],
      },
      loyalty_programs: {
        airlines: profile.preferences.preferredCarriers.map((c) => ({ airline_code: c })),
      },
      flight_preferences: { preferred_cabin: 'economy', max_acceptable_layovers: 1 },
      ground_transport_preferences: {},
      autonomous_rebooking_rules: {
        optimization_strategy: 'earliest_arrival',
        auto_approve_rebooking: true,
        hotel_trigger_threshold_hours: 6,
        rental_car_trigger_threshold_hours: 24,
      },
    },
    profile.payment.billingCurrency,
  );
  base.preferences.cabinEntitlement = profile.preferences.cabinEntitlement;
  return { profile, base };
}

/**
 * Rank the flight's CURRENT candidates for presentation. This is the member's
 * browsable list; the authoritative chosen plan is `preferredPlan()` (the
 * pipeline's own richer ranking, which also carries the risk signals this
 * presentation rank omits). Kept in sync by pinning the pipeline's choice to the
 * front below.
 */
function rankPortfolio(
  flight: Flight,
  prefs: AdaptedPreferences,
  partySize: number,
  extraPreferredCarriers: string[],
  deadlineISO: string | null,
) {
  const hardDeadlineISO = deadlineISO ?? flight.hardDeadlineISO ?? null;
  const scoredFlight: Flight = {
    ...flight,
    hardDeadlineISO,
    hasHardConstraint: flight.hasHardConstraint || hardDeadlineISO != null,
  };
  const ctx: ScoreContext = {
    flight: scoredFlight,
    rules: prefs.rules,
    preferredCabin: prefs.preferredCabin,
    partySize,
    displayCurrency: BILLING_CURRENCY,
    preferredCarriers: [...extraPreferredCarriers, ...prefs.preferences.preferredCarriers],
    hasHardConstraint: scoredFlight.hasHardConstraint,
  };
  const party = altsForParty(flight.candidates.alts, partySize);
  const { kept, removed } = applyHardRules(party, ctx);
  return { ranked: rankAlts(kept, ctx), removed, kept };
}

/** The response body shared by POST and DELETE — a freshly searched portfolio. */
function portfolioResponse(
  flight: Flight,
  ranked: ReturnType<typeof rankPortfolio>['ranked'],
  removed: ReturnType<typeof rankPortfolio>['removed'],
  plan: { altId: string; hotelId: string | null; cabId: string | null } | null,
  extra: Record<string, unknown>,
) {
  // Float the plan the pipeline actually chose to the top, so the member's
  // highlighted leader is the thing that would be booked even when the two
  // rankers order the tail slightly differently.
  const options = ranked.map((s) => ({
    id: s.alt.id,
    code: s.alt.code,
    dep: s.alt.dep,
    arr: s.alt.arr,
    cabin: s.alt.cabin,
    partyFare: s.alt.partyFare,
    currency: s.alt.currency,
    quoted: s.alt.quoted ?? null,
    ok: s.alt.ok,
    why: s.why,
    score: s.score.total,
  }));
  if (plan?.altId) {
    const i = options.findIndex((o) => o.id === plan.altId);
    if (i > 0) options.unshift(options.splice(i, 1)[0]);
  }
  return NextResponse.json({
    understood: true,
    removed,
    options,
    plan,
    // The re-composed bundle. Empty when this recovery does not need an overnight
    // (a same-day seat), exactly as the pipeline decides.
    hotels: flight.candidates.hotels,
    cabs: flight.candidates.cabs,
    ...extra,
  });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await requireSession(req);
  if ('response' in g) return g.response;

  const { id } = await params;
  const parsed = await parseJsonBody(req, isIntentBody);
  if ('response' in parsed) return parsed.response;

  const flight = await store.getFlight(id);
  if (!flight) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const bookings = await store.getBookingsForFlight(id);
  const booking = bookings.find((b) => b.passengerId === g.passenger.id);
  const partySize = booking ? store.partySize(booking) : 1;

  const { profile, base } = await basePreferencesFor(g.passenger.id);

  // The options the model sees, for resolving references like "the IndiGo one"
  // and noticing when nothing meets the ask. Read BEFORE the re-plan, from the
  // candidates currently in hand — the model translates the sentence, it does
  // not need the fresh search to do so.
  const party = altsForParty(flight.candidates.alts, partySize);

  const ctx: IntentContext = {
    nowISO: new Date().toISOString(),
    flight: {
      code: flight.code, from: flight.from, to: flight.to,
      departsISO: flight.depISO, partySize,
    },
    forecast: flight.forecast ? { pct: flight.forecast.pct, band: flight.forecast.band } : null,
    cabinEntitlement: profile.preferences.cabinEntitlement,
    billingCurrency: profile.payment.billingCurrency,
    carriersOnRoute: [
      ...new Set(party.map((a) => a.code.split(/\s+/)[0]?.toUpperCase()).filter(Boolean) as string[]),
    ],
    current: {
      strategy: base.rules.strategy,
      avoidAirlines: base.rules.avoidAirlines,
      maxLayovers: base.rules.maxLayovers,
      allowCabinDowngrade: base.rules.allowCabinDowngrade,
    },
    options: party.map((a) => ({
      code: a.code, dep: a.dep, arr: a.arr, cabin: a.cabin,
      fare: a.partyFare, currency: a.currency, seats: a.seats, ok: a.ok,
    })),
  };

  const result = await readIntent(parsed.body.text, ctx);

  // Failure is "no change", explicitly. An unconfigured key, a timeout or an
  // unparseable answer must leave the member exactly where they were — no
  // session override written, no re-plan run.
  if (!result) {
    return NextResponse.json({
      understood: false,
      message:
        'We could not read that. Your existing preferences are unchanged — you can pick an option yourself below, or try rephrasing.',
    });
  }

  // Persist the override as per-flight session state, THEN re-plan. plan() reads
  // exactly this record, so the fresh search + compose + rank all honour it.
  await store.setSessionPrefs({
    flightId: id,
    passengerId: g.passenger.id,
    override: result.override,
    restated: result.override.restated_intent,
    setAt: Date.now(),
  });
  await planForPreferences(id, g.passenger.id).catch(() => {});

  // Read back the freshly searched + re-composed flight and the pipeline's choice.
  const freshFlight = (await store.getFlight(id)) ?? flight;
  const plan = preferredPlan(id, g.passenger.id);

  // A deadline or a departure floor the member just stated is a hard rule, and
  // `applyHardRules` reads both off the flight rather than the rules object.
  // Applied to a COPY of the freshly re-planned flight, not the stale one: this
  // presentation rank must reflect it even on the first turn `earliest_departure_iso`
  // is stated, whether or not the real replan above already threaded it through —
  // a preview that still showed an option the member just excluded would look
  // broken regardless of what the pipeline would actually book.
  const previewFlight = (result.override.hard_deadline_iso || result.override.earliest_departure_iso)
    ? {
        ...freshFlight,
        ...(result.override.hard_deadline_iso
          ? { hardDeadlineISO: result.override.hard_deadline_iso, hasHardConstraint: true }
          : null),
        ...(result.override.earliest_departure_iso
          ? { earliestDepartISO: result.override.earliest_departure_iso }
          : null),
      }
    : freshFlight;

  const { ranked, removed } = rankPortfolio(
    previewFlight,
    // The route's presentation rank layers the same override the pipeline used,
    // so the browsable list and the pipeline's chosen plan agree.
    applyOverride(base, result.override),
    partySize,
    result.override.prefer_airlines,
    result.override.hard_deadline_iso,
  );

  try {
    logMemberIntent({
      flightId: id,
      passengerId: g.passenger.id,
      restated: result.override.restated_intent,
      confidence: result.override.confidence,
      changes: result.diff.changes,
      clamped: result.diff.clamped,
      unsupported: result.diff.unsupported.map((u) => u.asked),
      keptCount: ranked.length,
      removedCount: removed.length,
    });
  } catch {
    // Ledger I/O must never break the member's screen.
  }

  return portfolioResponse(freshFlight, ranked, removed, plan, {
    restated: result.override.restated_intent,
    confidence: result.override.confidence,
    diff: result.diff,
    override: result.override,
  });
}

/** Undo: drop the session override and re-plan on plain MyCa preferences. */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await requireSession(req);
  if ('response' in g) return g.response;

  const { id } = await params;
  const flight = await store.getFlight(id);
  if (!flight) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const bookings = await store.getBookingsForFlight(id);
  const booking = bookings.find((b) => b.passengerId === g.passenger.id);
  const partySize = booking ? store.partySize(booking) : 1;

  await store.clearSessionPrefs(id, g.passenger.id);
  await planForPreferences(id, g.passenger.id).catch(() => {});

  const { base } = await basePreferencesFor(g.passenger.id);
  const freshFlight = (await store.getFlight(id)) ?? flight;
  const plan = preferredPlan(id, g.passenger.id);
  const { ranked, removed } = rankPortfolio(freshFlight, base, partySize, [], null);

  return portfolioResponse(freshFlight, ranked, removed, plan, { cleared: true });
}
