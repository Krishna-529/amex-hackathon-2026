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
 * Replaces the ad hoc `defaultAlt` picking that used to live inline in
 * server/engine/simulation.ts's createTaskForBooking — same allocation
 * priority (03-action-policy.md §5: carrier-protected first, then any
 * eligible market alt), now an explicit, independently testable graph with
 * one node per specialist plus a supervisor that assembles the plan.
 */
import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import { classify, type Classification, type DisruptionKind, type SignalInput } from '@/lib/disruptionKind';
import { altsForParty } from '../domain/altsForParty';
import type { Flight } from '../domain/types';

export type RecoveryPlan = {
  kind: DisruptionKind;
  needsRebooking: boolean;
  needsRetiming: boolean;
  chosenAltId: string | null;
  chosenHotelId: string | null;
  chosenCabId: string | null;
  /** derived from whether the ORIGINAL flight operated — feeds the OPA
   *  voluntary_under_autopilot rule directly (03-action-policy.md §5). */
  disposition: 'involuntary' | 'voluntary';
  rationale: string[];
};

const PlanningState = Annotation.Root({
  flight: Annotation<Flight>,
  partySize: Annotation<number>,
  rejectedAltIds: Annotation<string[]>({ reducer: (_prev, next) => next, default: () => [] }),
  signal: Annotation<SignalInput>,
  classification: Annotation<Classification | null>({ reducer: (_prev, next) => next, default: () => null }),
  chosenAltId: Annotation<string | null>({ reducer: (_prev, next) => next, default: () => null }),
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

/** Flight specialist: proposes a candidate only when the classification
 *  actually needs one — a reschedule the connection survives keeps the
 *  original ticket (03-action-policy.md §2.1), so this node is a no-op then,
 *  never a forced pick. */
function flightSpecialistNode(state: State): Partial<State> {
  if (!state.classification?.needsRebooking) return {};

  const partyAlts = altsForParty(state.flight.candidates.alts, state.partySize)
    .filter((a) => !state.rejectedAltIds.includes(a.id));

  const pick =
    partyAlts.find((a) => a.kind === 'carrier-protected' && a.ok) // priority 1: what the carrier owes
    ?? partyAlts.find((a) => a.ok) // priority 4: any eligible market alt
    ?? null;

  return {
    chosenAltId: pick?.id ?? null,
    rationale: pick
      ? [`Flight specialist: ${pick.kind === 'carrier-protected' ? 'carrier-owed seat' : 'market alt'} ${pick.code} — ${pick.why}`]
      : ['Flight specialist: no eligible candidate in the current portfolio.'],
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
}): Promise<RecoveryPlan> {
  const result = await graph.invoke({
    flight: input.flight,
    partySize: input.partySize,
    rejectedAltIds: input.rejectedAltIds,
    signal: input.signal,
  });

  const classification = result.classification as Classification;
  return {
    kind: classification.kind,
    needsRebooking: classification.needsRebooking,
    needsRetiming: classification.needsRetiming,
    chosenAltId: result.chosenAltId,
    chosenHotelId: result.chosenHotelId,
    chosenCabId: result.chosenCabId,
    disposition: classification.freeToFix ? 'involuntary' : 'voluntary',
    rationale: result.rationale,
  };
}
