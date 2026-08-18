/**
 * Layer A — the read-only planning graph (architecture diagram Part 03:
 * "supervisor · flight · hotel · ground · duty-of-care — read-only tools,
 * zero execution/spend authority"). Built with LangGraph.js so "zero
 * execution authority" is structural, not a comment: every node here only
 * reads `Flight.candidates` (already fetched by server/engine/altsCache.ts
 * and groundCache.ts) and returns a pick. Nothing in this module can import
 * a book()/cancel() implementation — those live in the separate zkd-execute
 * package, which zkd-app never depends on.
 *
 * The flight specialist's pick is a real six-criterion ranking
 * (server/pipeline/score.ts), not a bare priority `.find()` — see
 * server/preferences/ for the member-preference wire schema it ranks
 * against. Hard rules (avoid_airlines, party-fit, cabin-downgrade-not-
 * allowed) still run first and can never be outvoted by the weighted score.
 */
import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import { classify, type Classification, type DisruptionKind, type SignalInput } from '@/lib/disruptionKind';
import { altsForParty } from '../domain/altsForParty';
import { applyHardRules, rankAlts, type ScoreContext } from '../pipeline/score';
import type { AdaptedPreferences } from '../preferences/adapt';
import type { CabinClass } from '../myca';
import type { Flight, OptionReason } from '../domain/types';

export type RecoveryPlan = {
  kind: DisruptionKind;
  needsRebooking: boolean;
  needsRetiming: boolean;
  chosenAltId: string | null;
  chosenHotelId: string | null;
  chosenCabId: string | null;
  /** Why chosenAltId was picked — always non-null whenever chosenAltId is. */
  chosenAltReason: OptionReason | null;
  /** The full ranked candidate list surviving hard rules, each with its own
   *  reasoning — what the "browse other options" UI reads. */
  rankedAlts: { altId: string; reason: OptionReason }[];
  /** Candidates a hard rule removed before scoring, and which rule — surfaced
   *  for transparency, never silently dropped. */
  excludedAlts: { altId: string; code: string; rule: string }[];
  /** derived from whether the ORIGINAL flight operated — feeds the OPA
   *  voluntary_under_autopilot rule directly (03-action-policy.md §5). */
  disposition: 'involuntary' | 'voluntary';
  rationale: string[];
};

const CABIN_RANK: Record<CabinClass, number> = { Economy: 0, 'Premium Economy': 1, Business: 2, First: 3 };

const PlanningState = Annotation.Root({
  flight: Annotation<Flight>,
  partySize: Annotation<number>,
  rejectedAltIds: Annotation<string[]>({ reducer: (_prev, next) => next, default: () => [] }),
  signal: Annotation<SignalInput>,
  adaptedPreferences: Annotation<AdaptedPreferences>,
  cap: Annotation<{ amount: number; currency: string }>,
  classification: Annotation<Classification | null>({ reducer: (_prev, next) => next, default: () => null }),
  chosenAltId: Annotation<string | null>({ reducer: (_prev, next) => next, default: () => null }),
  chosenAltReason: Annotation<OptionReason | null>({ reducer: (_prev, next) => next, default: () => null }),
  rankedAlts: Annotation<{ altId: string; reason: OptionReason }[]>({ reducer: (_prev, next) => next, default: () => [] }),
  excludedAlts: Annotation<{ altId: string; code: string; rule: string }[]>({ reducer: (_prev, next) => next, default: () => [] }),
  chosenHotelId: Annotation<string | null>({ reducer: (_prev, next) => next, default: () => null }),
  chosenCabId: Annotation<string | null>({ reducer: (_prev, next) => next, default: () => null }),
  rationale: Annotation<string[]>({ reducer: (prev, next) => prev.concat(next), default: () => [] }),
});

type State = typeof PlanningState.State;

function classifyNode(state: State): Partial<State> {
  const classification = classify(state.signal);
  return { classification, rationale: [`Classified as ${classification.kind} — ${describeClassification(classification)}.`] };
}

function describeClassification(c: Classification): string {
  if (!c.needsRebooking && !c.needsRetiming) return 'nothing to act on';
  if (!c.needsRebooking) return 'connection survives, so only hotel/ground need re-timing, no new seat';
  return c.breaksConnection ? 'the onward connection breaks, a new seat is required' : 'a new seat is required';
}

/** Flight specialist: proposes a ranked portfolio only when the
 *  classification actually needs one — a reschedule the connection survives
 *  keeps the original ticket (03-action-policy.md §2.1), so this node is a
 *  no-op then, never a forced pick. Ranking is server/pipeline/score.ts's
 *  applyHardRules()+rankAlts(), member-preference-aware — see
 *  server/preferences/. */
function flightSpecialistNode(state: State): Partial<State> {
  if (!state.classification?.needsRebooking) return {};

  const partyAlts = altsForParty(state.flight.candidates.alts, state.partySize)
    .filter((a) => !state.rejectedAltIds.includes(a.id));

  // Preferred cabin may never raise the entitlement ceiling — entitlement
  // always wins, preference only ranks within it (server/preferences/adapt.ts's
  // own stated rule, but adapt() itself has no MyCa access at translation
  // time to enforce it). This is the one call site with both numbers.
  const entitlement = CABIN_RANK[state.adaptedPreferences.preferences.cabinEntitlement] ?? 0;
  const preferredCabin = (CABIN_RANK[state.adaptedPreferences.preferredCabin] ?? 0) <= entitlement
    ? state.adaptedPreferences.preferredCabin
    : state.adaptedPreferences.preferences.cabinEntitlement;

  const ctx: ScoreContext = {
    flight: state.flight,
    rules: state.adaptedPreferences.rules,
    preferredCabin,
    partySize: state.partySize,
    cap: state.cap,
    preferredCarriers: state.adaptedPreferences.preferences.preferredCarriers,
    hasHardConstraint: state.flight.hasHardConstraint,
  };

  const { kept, removed } = applyHardRules(partyAlts, ctx);
  const ranked = rankAlts(kept, ctx);
  const top = ranked[0] ?? null;

  return {
    chosenAltId: top?.alt.id ?? null,
    chosenAltReason: top
      ? { kind: 'deterministic-score', text: top.why, leadingCriterion: top.score.leadingCriterion }
      : null,
    rankedAlts: ranked.map((r) => ({
      altId: r.alt.id,
      reason: { kind: 'deterministic-score' as const, text: r.why, leadingCriterion: r.score.leadingCriterion },
    })),
    excludedAlts: removed.map((r) => ({ altId: r.id, code: r.code, rule: r.rule })),
    rationale: top
      ? [`Flight specialist: ${top.alt.kind === 'carrier-protected' ? 'carrier-owed seat' : 'market alt'} ${top.alt.code} — ${top.why}`]
      : [`Flight specialist: no eligible candidate survived your own rules (${removed.map((r) => r.rule).join('; ') || 'portfolio was empty'}).`],
  };
}

function hotelSpecialistNode(state: State): Partial<State> {
  if (!state.classification?.needsRetiming) return {};
  const pick = state.flight.candidates.hotels.find((h) => h.ok) ?? null;
  return {
    chosenHotelId: pick?.id ?? null,
    rationale: pick ? [`Hotel specialist: ${pick.name} — ${pick.why}`] : [],
  };
}

function groundSpecialistNode(state: State): Partial<State> {
  if (!state.classification?.needsRetiming) return {};
  const pick = state.flight.candidates.cabs.find((c) => c.ok) ?? null;
  return {
    chosenCabId: pick?.id ?? null,
    rationale: pick ? [`Ground specialist: ${pick.kind} — ${pick.why}`] : [],
  };
}

/** Supervisor: assembles what the specialists proposed into one plan. No
 *  negotiation loop lives here today (the halt conditions in
 *  zkd-shared/src/haltConditions.ts govern that, called by the caller around
 *  this graph) — this node's job is strictly composition, not iteration. */
function supervisorNode(state: State): Partial<State> {
  const disposition: RecoveryPlan['disposition'] = state.classification?.freeToFix ? 'involuntary' : 'voluntary';
  return { rationale: [`Supervisor: assembled plan, disposition=${disposition}.`] };
}

const graph = new StateGraph(PlanningState)
  .addNode('classify', classifyNode)
  .addNode('flightSpecialist', flightSpecialistNode)
  .addNode('hotelSpecialist', hotelSpecialistNode)
  .addNode('groundSpecialist', groundSpecialistNode)
  .addNode('supervisor', supervisorNode)
  .addEdge(START, 'classify')
  .addEdge('classify', 'flightSpecialist')
  .addEdge('flightSpecialist', 'hotelSpecialist')
  .addEdge('hotelSpecialist', 'groundSpecialist')
  .addEdge('groundSpecialist', 'supervisor')
  .addEdge('supervisor', END)
  .compile();

export async function planRecovery(input: {
  flight: Flight;
  partySize: number;
  rejectedAltIds: string[];
  signal: SignalInput;
  adaptedPreferences: AdaptedPreferences;
  cap: { amount: number; currency: string };
}): Promise<RecoveryPlan> {
  const result = await graph.invoke({
    flight: input.flight,
    partySize: input.partySize,
    rejectedAltIds: input.rejectedAltIds,
    signal: input.signal,
    adaptedPreferences: input.adaptedPreferences,
    cap: input.cap,
  });

  const classification = result.classification as Classification;
  return {
    kind: classification.kind,
    needsRebooking: classification.needsRebooking,
    needsRetiming: classification.needsRetiming,
    chosenAltId: result.chosenAltId,
    chosenAltReason: result.chosenAltReason,
    rankedAlts: result.rankedAlts,
    excludedAlts: result.excludedAlts,
    chosenHotelId: result.chosenHotelId,
    chosenCabId: result.chosenCabId,
    disposition: classification.freeToFix ? 'involuntary' : 'voluntary',
    rationale: result.rationale,
  };
}
