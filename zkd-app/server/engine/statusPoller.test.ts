/**
 * The selection rule is the whole design, so it is what gets tested.
 *
 * AviationStack allows 100 calls a month. What keeps this poller inside that is
 * not the interval — it is `flightsToPoll` refusing to look at most flights at
 * all. A regression here would not fail loudly; it would quietly exhaust a
 * month's allowance in an afternoon and leave the product blind for four weeks.
 * That is precisely the kind of failure worth a test.
 */
import { describe, expect, it } from 'vitest';
import { flightsToPoll } from './statusPoller';
import type { Flight } from '../domain/types';

const NOW = Date.UTC(2026, 7, 19, 12, 0, 0);
const minutesOut = (m: number) => new Date(NOW + m * 60_000).toISOString();

function flight(over: Partial<Flight> & { id: string }): Flight {
  return {
    code: '6E 100', from: 'BOM', to: 'DEL',
    depISO: minutesOut(600),
    durationMin: 120,
    connectionSlackMinutes: null,
    hasHardConstraint: false,
    candidates: { alts: [], hotels: [], cabs: [], cabLegs: [] },
    ...over,
  } as Flight;
}

const withBand = (id: string, band: string, mins: number) =>
  flight({ id, depISO: minutesOut(mins), forecast: { band } as Flight['forecast'] });

describe('flightsToPoll', () => {
  it('watches a flight close to departure', () => {
    const f = flight({ id: 'near', depISO: minutesOut(30) });
    expect(flightsToPoll([f], NOW).map((x) => x.id)).toEqual(['near']);
  });

  it('ignores a flight days away that nothing is worried about', () => {
    const f = flight({ id: 'far', depISO: minutesOut(60 * 24 * 3) });
    expect(flightsToPoll([f], NOW)).toEqual([]);
  });

  it('watches a far-out flight the model has already escalated', () => {
    const f = withBand('worried', 'pre-authorise', 60 * 24 * 2);
    expect(flightsToPoll([f], NOW).map((x) => x.id)).toEqual(['worried']);
  });

  it('does not watch a far-out flight still sitting at watch', () => {
    const f = withBand('calm', 'watch', 60 * 24 * 2);
    expect(flightsToPoll([f], NOW)).toEqual([]);
  });

  it('drops a flight that has already gone — it cannot be cancelled now', () => {
    const f = flight({ id: 'gone', depISO: minutesOut(-180) });
    expect(flightsToPoll([f], NOW)).toEqual([]);
  });

  it('still watches one that has only just left, in case the feed is behind', () => {
    const f = flight({ id: 'justwent', depISO: minutesOut(-20) });
    expect(flightsToPoll([f], NOW).map((x) => x.id)).toEqual(['justwent']);
  });

  it('spends the scarcest calls on the least runway — soonest departure first', () => {
    const later = flight({ id: 'later', depISO: minutesOut(50) });
    const sooner = flight({ id: 'sooner', depISO: minutesOut(10) });
    const middle = flight({ id: 'middle', depISO: minutesOut(25) });
    expect(flightsToPoll([later, sooner, middle], NOW).map((f) => f.id)).toEqual([
      'sooner',
      'middle',
      'later',
    ]);
  });

  it('watches nothing at all when there is nothing urgent', () => {
    expect(flightsToPoll([withBand('a', 'watch', 60 * 24 * 5)], NOW)).toEqual([]);
  });
});
