/**
 * "Tell us what you'd prefer" — free text in, re-ranked options out.
 *
 * **This route applies nothing.** It reads the member's sentence, turns it into
 * a validated preference delta, re-runs the ordinary deterministic scorer with
 * that delta layered on, and returns the result *for the member to look at*.
 * Their stored preferences are untouched and no recovery is altered until they
 * confirm, at which point `/api/flights/[id]/preauth` records it.
 *
 * That read-only stance is the whole design. A member typing a sentence into a
 * box at the moment their flight is about to cancel should be able to see what
 * it would do before it does it — and if the model misreads them, the cost of
 * that mistake should be a list they disagree with, not a booking they did not
 * want.
 */
import { NextRequest, NextResponse } from 'next/server';
import * as store from '@/server/domain/store';
import { requireSession } from '@/server/auth/guard';
import { parseJsonBody, isNonEmptyString } from '@/server/jsonBody';
import { fetchProfile, BILLING_CURRENCY } from '@/server/myca';
import { adapt } from '@/server/preferences/adapt';
import { readIntent, applyOverride, type IntentContext } from '@/server/preferences/intent';
import { altsForParty } from '@/server/domain/altsForParty';
import { applyHardRules, rankAlts, type ScoreContext } from '@/server/pipeline/score';
import { logMemberIntent } from '@/server/decisionLedger';

type IntentBody = { text: string };

function isIntentBody(v: unknown): v is IntentBody {
  return typeof v === 'object' && v !== null && isNonEmptyString((v as { text?: unknown }).text);
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

  const profile = await fetchProfile(g.passenger.id);
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
  // unparseable answer must never leave the member with half an instruction
  // applied — they keep exactly what they had and are told we could not read it.
  if (!result) {
    return NextResponse.json({
      understood: false,
      message:
        'We could not read that. Your existing preferences are unchanged — you can pick an option yourself below, or try rephrasing.',
    });
  }

  const withOverride = applyOverride(base, result.override);

  // A deadline the member just stated is a hard rule, and `applyHardRules`
  // reads it off the flight rather than the rules object. Applied to a COPY:
  // this is a preview, and a stored flight must not acquire a deadline from a
  // sentence the member has not confirmed yet.
  const previewFlight = result.override.hard_deadline_iso
    ? { ...flight, hardDeadlineISO: result.override.hard_deadline_iso, hasHardConstraint: true }
    : flight;

  const scoreCtx: ScoreContext = {
    flight: previewFlight,
    rules: withOverride.rules,
    preferredCabin: withOverride.preferredCabin,
    partySize,
    displayCurrency: BILLING_CURRENCY,
    preferredCarriers: [
      ...result.override.prefer_airlines,
      ...withOverride.preferences.preferredCarriers,
    ],
    hasHardConstraint: previewFlight.hasHardConstraint,
  };

  const { kept, removed } = applyHardRules(party, scoreCtx);
  const ranked = rankAlts(kept, scoreCtx);

  // What a member asked for, in their own words, is exactly the kind of claim
  // that should be checkable afterwards — especially now that a stated budget
  // is a hard rule and a stated deadline can remove every option.
  try {
    logMemberIntent({
      flightId: id,
      passengerId: g.passenger.id,
      restated: result.override.restated_intent,
      confidence: result.override.confidence,
      changes: result.diff.changes,
      clamped: result.diff.clamped,
      unsupported: result.diff.unsupported.map((u) => u.asked),
      keptCount: kept.length,
      removedCount: removed.length,
    });
  } catch {
    // Ledger I/O must never break the member's screen.
  }

  return NextResponse.json({
    understood: true,
    restated: result.override.restated_intent,
    confidence: result.override.confidence,
    diff: result.diff,
    override: result.override,
    // Everything excluded, with the rule that excluded it. "We found nothing"
    // and "your own instruction excluded everything" are different answers and
    // the member is owed the second one.
    removed,
    options: ranked.map((s) => ({
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
    })),
  });
}
