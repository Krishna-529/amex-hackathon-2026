import { describe, expect, it } from 'vitest';
import { evaluateHaltConditions, type HaltInput } from './haltConditions';

const clean: HaltInput = {
  memberInterventionOutstanding: false,
  iteration: 0,
  iterationCap: 3,
  deltaBelowEpsilon: false,
  feasibleSetChanged: true,
  tupleAlreadyVisited: false,
  forecastBelowHoldGate: false,
  feasibleSetEmpty: false,
};

describe('evaluateHaltConditions (03-action-policy.md §7, first match wins)', () => {
  it('continues when nothing is triggered', () => {
    expect(evaluateHaltConditions(clean)).toEqual({ kind: 'continue' });
  });

  it('1. member intervention outstanding beats every other condition', () => {
    const input: HaltInput = {
      ...clean,
      memberInterventionOutstanding: true,
      feasibleSetEmpty: true, // would otherwise escalate — intervention must win
    };
    expect(evaluateHaltConditions(input)).toEqual({ kind: 'suspend-for-member' });
  });

  it('2. iteration cap reached emits best feasible', () => {
    expect(evaluateHaltConditions({ ...clean, iteration: 3, iterationCap: 3 })).toEqual({ kind: 'emit-best-feasible' });
    expect(evaluateHaltConditions({ ...clean, iteration: 5, iterationCap: 3 })).toEqual({ kind: 'emit-best-feasible' });
  });

  it('3. converged and unchanged emits held baseline', () => {
    expect(evaluateHaltConditions({ ...clean, deltaBelowEpsilon: true, feasibleSetChanged: false })).toEqual({
      kind: 'emit-held-baseline',
    });
  });

  it('converging is not enough on its own — the feasible set must also be unchanged', () => {
    expect(evaluateHaltConditions({ ...clean, deltaBelowEpsilon: true, feasibleSetChanged: true })).toEqual({
      kind: 'continue',
    });
  });

  it('4. a revisited tuple emits held baseline — prevents ping-pong', () => {
    expect(evaluateHaltConditions({ ...clean, tupleAlreadyVisited: true })).toEqual({ kind: 'emit-held-baseline' });
  });

  it('5. forecast decayed below the hold gate releases at zero cost', () => {
    expect(evaluateHaltConditions({ ...clean, forecastBelowHoldGate: true })).toEqual({
      kind: 'terminal',
      state: 'RELEASED',
    });
  });

  it('6. empty feasible set escalates', () => {
    expect(evaluateHaltConditions({ ...clean, feasibleSetEmpty: true })).toEqual({
      kind: 'terminal',
      state: 'ESCALATED',
    });
  });

  it('ordering: hold-gate decay is checked before an empty feasible set', () => {
    const input: HaltInput = { ...clean, forecastBelowHoldGate: true, feasibleSetEmpty: true };
    expect(evaluateHaltConditions(input)).toEqual({ kind: 'terminal', state: 'RELEASED' });
  });
});
