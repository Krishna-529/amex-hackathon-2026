import { describe, it, expect } from 'vitest';
import { reconcileChoices, type ResolvedChoice } from './reconcile.ts';
import type { ShownSetEntry } from './decisionLog.ts';

function shownSet(overrides: Partial<ShownSetEntry> & { decisionId: string }): ShownSetEntry {
  return {
    loggedAt: 1000,
    flightId: 'f1',
    memberId: 'm1',
    strategy: 'balanced',
    weightsVersion: 1,
    weights: {} as any,
    candidates: [
      { altId: 'a1', code: 'A1', features: {} as any, bookability: 1, utility: 1, rank: 0, propensity: 1 },
      { altId: 'a2', code: 'A2', features: {} as any, bookability: 1, utility: 0.5, rank: 1, propensity: 1 },
    ],
    ...overrides,
  };
}

describe('reconcileChoices', () => {
  it('joins a resolved task to the shown set that contains the chosen alt', () => {
    const shown = [shownSet({ decisionId: 'd1', loggedAt: 1000 })];
    const resolved: ResolvedChoice[] = [
      { flightId: 'f1', memberId: 'm1', chosenAltId: 'a2', resolvedAt: 2000, kind: 'approved' },
    ];
    const out = reconcileChoices(shown, resolved);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ decisionId: 'd1', chosenAltId: 'a2', by: 'approved' });
  });

  it('picks the most recent shown set at or before the resolution, not the first', () => {
    const shown = [
      shownSet({ decisionId: 'd1', loggedAt: 1000 }),
      shownSet({ decisionId: 'd2', loggedAt: 1500 }),
      shownSet({ decisionId: 'd3', loggedAt: 3000 }), // after resolution — must not be picked
    ];
    const resolved: ResolvedChoice[] = [
      { flightId: 'f1', memberId: 'm1', chosenAltId: 'a1', resolvedAt: 2000, kind: 'autopilot' },
    ];
    const out = reconcileChoices(shown, resolved);
    expect(out).toHaveLength(1);
    expect(out[0].decisionId).toBe('d2');
  });

  it('skips a resolution whose chosen alt never appears in any preceding shown set', () => {
    const shown = [shownSet({ decisionId: 'd1', loggedAt: 1000 })];
    const resolved: ResolvedChoice[] = [
      { flightId: 'f1', memberId: 'm1', chosenAltId: 'never-shown', resolvedAt: 2000, kind: 'approved' },
    ];
    expect(reconcileChoices(shown, resolved)).toHaveLength(0);
  });

  it('skips a resolution with no shown set at all before it', () => {
    const shown = [shownSet({ decisionId: 'd1', loggedAt: 5000 })]; // only after resolution
    const resolved: ResolvedChoice[] = [
      { flightId: 'f1', memberId: 'm1', chosenAltId: 'a1', resolvedAt: 2000, kind: 'approved' },
    ];
    expect(reconcileChoices(shown, resolved)).toHaveLength(0);
  });

  it('skips a resolution with an empty chosenAltId', () => {
    const shown = [shownSet({ decisionId: 'd1', loggedAt: 1000 })];
    const resolved: ResolvedChoice[] = [
      { flightId: 'f1', memberId: 'm1', chosenAltId: '', resolvedAt: 2000, kind: 'approved' },
    ];
    expect(reconcileChoices(shown, resolved)).toHaveLength(0);
  });

  it('keeps flights and members separate — a shown set for a different flight or member never matches', () => {
    const shown = [
      shownSet({ decisionId: 'd1', loggedAt: 1000, flightId: 'f1', memberId: 'm1' }),
      shownSet({ decisionId: 'd2', loggedAt: 1000, flightId: 'f2', memberId: 'm1' }),
      shownSet({ decisionId: 'd3', loggedAt: 1000, flightId: 'f1', memberId: 'm2' }),
    ];
    const resolved: ResolvedChoice[] = [
      { flightId: 'f1', memberId: 'm1', chosenAltId: 'a1', resolvedAt: 2000, kind: 'approved' },
    ];
    const out = reconcileChoices(shown, resolved);
    expect(out).toHaveLength(1);
    expect(out[0].decisionId).toBe('d1');
  });

  it('carries bookedOk through when present', () => {
    const shown = [shownSet({ decisionId: 'd1', loggedAt: 1000 })];
    const resolved: ResolvedChoice[] = [
      { flightId: 'f1', memberId: 'm1', chosenAltId: 'a1', resolvedAt: 2000, kind: 'autopilot', bookedOk: true },
    ];
    expect(reconcileChoices(shown, resolved)[0].bookedOk).toBe(true);
  });

  it('reconciles independently across multiple resolved tasks on the same flight+member', () => {
    const shown = [
      shownSet({ decisionId: 'd1', loggedAt: 1000 }),
      shownSet({ decisionId: 'd2', loggedAt: 4000 }),
    ];
    const resolved: ResolvedChoice[] = [
      { flightId: 'f1', memberId: 'm1', chosenAltId: 'a1', resolvedAt: 2000, kind: 'approved' },
      { flightId: 'f1', memberId: 'm1', chosenAltId: 'a2', resolvedAt: 5000, kind: 'autopilot' },
    ];
    const out = reconcileChoices(shown, resolved);
    expect(out).toHaveLength(2);
    expect(out[0].decisionId).toBe('d1');
    expect(out[1].decisionId).toBe('d2');
  });
});
