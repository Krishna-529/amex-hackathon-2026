/**
 * "Tell us what you'd prefer" — now a running conversation, not a one-shot box.
 *
 * **This route still applies nothing.** Each member message is turned into a
 * validated, COMPLETE preference state (the model re-derives everything the
 * traveller has said across the whole conversation, so a later message can add
 * to — or take back — an earlier one), the ordinary deterministic scorer is
 * re-run with that state layered on, and the result is returned *for the member
 * to look at*. Their stored MyCa preferences are untouched and no recovery is
 * altered until they confirm, at which point `/api/flights/[id]/preauth` records
 * the option they picked.
 *
 * The conversation is persisted per (flight, passenger) — the same temporary,
 * per-flight storage `journey_prefs` and `pre_auths` use — so it survives a page
 * refresh and can be rewound one turn (undo) or cleared (reset) without a model
 * call. Verbs:
 *   GET                      → restore the thread + the current ranking
 *   POST { text }            → add a member message (one Gemini call)
 *   POST { undo: true }      → drop the last round, re-rank from the prior state
 *   DELETE                   → clear the conversation, back to plain MyCa
 */
import { NextRequest, NextResponse } from 'next/server';
import * as store from '@/server/domain/store';
import { requireSession } from '@/server/auth/guard';
import { parseJsonBody } from '@/server/jsonBody';
import { fetchProfile, BILLING_CURRENCY } from '@/server/myca';
import { adapt, type AdaptedPreferences } from '@/server/preferences/adapt';
import {
  readIntent, applyOverride, toTurns, currentSnapshot,
  type IntentContext, type IntentConversation, type PreferenceOverride,
} from '@/server/preferences/intent';
import { altsForParty, type PartyAlt } from '@/server/domain/altsForParty';
import { applyHardRules, rankAlts, type ScoreContext } from '@/server/pipeline/score';
import { logMemberIntent } from '@/server/decisionLedger';
import type { Flight } from '@/server/domain/types';

type IntentBody = { text?: string; undo?: boolean };

function isIntentBody(v: unknown): v is IntentBody {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as IntentBody;
  return typeof o.text === 'string' || o.undo === true;
}

// ── shared setup: one MyCa read, the scorer context, the candidate party ──────

type Assembled = { base: AdaptedPreferences; ctx: IntentContext; party: PartyAlt[]; partySize: number };

async function assemble(flight: Flight, passengerId: string): Promise<Assembled> {
  const bookings = await store.getBookingsForFlight(flight.id);
  const booking = bookings.find((b) => b.passengerId === passengerId);
  const partySize = booking ? store.partySize(booking) : 1;

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

  const party = altsForParty(flight.candidates.alts, partySize);
  const ctx: IntentContext = {
    nowISO: new Date().toISOString(),
    flight: { code: flight.code, from: flight.from, to: flight.to, departsISO: flight.depISO, partySize },
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
  return { base, ctx, party, partySize };
}

// ── rank a given (already-validated) preference state — no model call ─────────

function scoreSnapshot(flight: Flight, a: Assembled, snapshot: PreferenceOverride) {
  const withOverride = applyOverride(a.base, snapshot);
  // A stated deadline is a hard rule `applyHardRules` reads off the flight;
  // applied to a COPY so a stored flight never acquires a deadline the member
  // has not confirmed. (Same preview-flight rule the one-shot version used.)
  const previewFlight = snapshot.hard_deadline_iso
    ? { ...flight, hardDeadlineISO: snapshot.hard_deadline_iso, hasHardConstraint: true }
    : flight;
  const scoreCtx: ScoreContext = {
    flight: previewFlight,
    rules: withOverride.rules,
    preferredCabin: withOverride.preferredCabin,
    partySize: a.partySize,
    displayCurrency: BILLING_CURRENCY,
    preferredCarriers: [...snapshot.prefer_airlines, ...withOverride.preferences.preferredCarriers],
    hasHardConstraint: previewFlight.hasHardConstraint,
  };
  const { kept, removed } = applyHardRules(a.party, scoreCtx);
  const ranked = rankAlts(kept, scoreCtx);
  return {
    removed,
    options: ranked.map((s) => ({
      id: s.alt.id, code: s.alt.code, dep: s.alt.dep, arr: s.alt.arr, cabin: s.alt.cabin,
      partyFare: s.alt.partyFare, currency: s.alt.currency, quoted: s.alt.quoted ?? null,
      ok: s.alt.ok, why: s.why, score: s.score.total,
    })),
  };
}

// ── the response shape every verb returns ─────────────────────────────────────

function view(conv: IntentConversation | undefined, scored: ReturnType<typeof scoreSnapshot>, understood = true) {
  const rounds = conv?.rounds ?? [];
  const last = rounds[rounds.length - 1];
  return {
    understood,
    turns: toTurns(rounds),
    current: rounds.length ? currentSnapshot(conv) : null,
    diff: last ? last.diff : null,
    clarification: last?.assistant.isClarification ? last.assistant.text : null,
    removed: scored.removed,
    options: scored.options,
  };
}

// ── GET: restore thread + current ranking ─────────────────────────────────────

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await requireSession(req);
  if ('response' in g) return g.response;
  const { id } = await params;
  const flight = await store.getFlight(id);
  if (!flight) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const a = await assemble(flight, g.passenger.id);
  const conv = await store.getIntentConversation(id, g.passenger.id);
  const scored = scoreSnapshot(flight, a, currentSnapshot(conv));
  return NextResponse.json(view(conv, scored));
}

// ── DELETE: reset the conversation ────────────────────────────────────────────

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await requireSession(req);
  if ('response' in g) return g.response;
  const { id } = await params;
  const flight = await store.getFlight(id);
  if (!flight) return NextResponse.json({ error: 'not found' }, { status: 404 });

  await store.clearIntentConversation(id, g.passenger.id);
  const a = await assemble(flight, g.passenger.id);
  const scored = scoreSnapshot(flight, a, currentSnapshot(undefined));
  return NextResponse.json(view(undefined, scored));
}

// ── POST: a new member message, or an undo ────────────────────────────────────

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await requireSession(req);
  if ('response' in g) return g.response;

  const { id } = await params;
  const parsed = await parseJsonBody(req, isIntentBody);
  if ('response' in parsed) return parsed.response;

  const flight = await store.getFlight(id);
  if (!flight) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const a = await assemble(flight, g.passenger.id);
  const existing = await store.getIntentConversation(id, g.passenger.id);
  const conv: IntentConversation =
    existing ?? { flightId: id, passengerId: g.passenger.id, rounds: [], updatedAt: Date.now() };

  // Undo: drop the last round, re-rank from the prior state. No model call.
  if (parsed.body.undo) {
    if (conv.rounds.length) {
      conv.rounds = conv.rounds.slice(0, -1);
      conv.updatedAt = Date.now();
      await store.setIntentConversation(conv);
    }
    const scored = scoreSnapshot(flight, a, currentSnapshot(conv));
    return NextResponse.json(view(conv, scored));
  }

  // A new message. History is the conversation so far (before this message).
  const result = await readIntent(parsed.body.text ?? '', a.ctx, toTurns(conv.rounds));

  // Failure is "no change", explicitly — the thread and ranking are left exactly
  // as they were and the member is told we could not read that one message.
  if (!result) {
    const scored = scoreSnapshot(flight, a, currentSnapshot(conv));
    return NextResponse.json({
      ...view(conv, scored, false),
      message: 'We could not read that. Nothing changed — try rephrasing, or pick an option below.',
    });
  }

  const now = Date.now();
  const assistantText = result.override.clarification ?? result.override.restated_intent ?? 'Noted.';
  conv.rounds.push({
    memberText: (parsed.body.text ?? '').trim().slice(0, 600),
    at: now,
    snapshot: result.override,
    diff: result.diff,
    assistant: { text: assistantText, isClarification: !!result.override.clarification, at: now + 1 },
  });
  conv.updatedAt = now;
  await store.setIntentConversation(conv);

  const scored = scoreSnapshot(flight, a, result.override);

  try {
    logMemberIntent({
      flightId: id,
      passengerId: g.passenger.id,
      restated: result.override.restated_intent,
      confidence: result.override.confidence,
      changes: result.diff.changes,
      clamped: result.diff.clamped,
      unsupported: result.diff.unsupported.map((u) => u.asked),
      keptCount: scored.options.length,
      removedCount: scored.removed.length,
    });
  } catch {
    // Ledger I/O must never break the member's screen.
  }

  return NextResponse.json(view(conv, scored));
}
