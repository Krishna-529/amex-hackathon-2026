/**
 * The six halt conditions from 03-action-policy.md §7, in the order they're
 * defined — first match wins, and the loop always terminates. Pure function
 * so it's independently testable without the negotiation loop around it.
 */
export type HaltInput = {
  memberInterventionOutstanding: boolean;
  iteration: number;
  iterationCap: number;
  deltaBelowEpsilon: boolean;
  feasibleSetChanged: boolean;
  tupleAlreadyVisited: boolean;
  forecastBelowHoldGate: boolean;
  feasibleSetEmpty: boolean;
};

export type HaltOutcome =
  | { kind: 'continue' }
  | { kind: 'suspend-for-member' }
  | { kind: 'emit-best-feasible' }
  | { kind: 'emit-held-baseline' }
  | { kind: 'terminal'; state: 'RELEASED' }
  | { kind: 'terminal'; state: 'ESCALATED' };

export function evaluateHaltConditions(input: HaltInput): HaltOutcome {
  // 1. Member intervention outstanding — suspend; re-plan once; await member.
  if (input.memberInterventionOutstanding) return { kind: 'suspend-for-member' };

  // 2. Iteration cap reached — emit best feasible for confirmation; halt.
  if (input.iteration >= input.iterationCap) return { kind: 'emit-best-feasible' };

  // 3. Converged and nothing changed — emit held baseline; halt.
  if (input.deltaBelowEpsilon && !input.feasibleSetChanged) return { kind: 'emit-held-baseline' };

  // 4. Tuple already visited — emit held baseline; halt (prevents ping-pong).
  if (input.tupleAlreadyVisited) return { kind: 'emit-held-baseline' };

  // 5. Prediction decayed below the hold gate — release the hold at zero cost.
  if (input.forecastBelowHoldGate) return { kind: 'terminal', state: 'RELEASED' };

  // 6. Feasible set empty — next-day objective, claim duty of care, escalate.
  if (input.feasibleSetEmpty) return { kind: 'terminal', state: 'ESCALATED' };

  return { kind: 'continue' };
}
