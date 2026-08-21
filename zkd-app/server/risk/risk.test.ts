/**
 * Tests for the live disruption-risk layer: the weather-severity mapping, and
 * the aggregator's tolerate-absence contract (a feed that is off or fails must
 * degrade to an empty map, never throw).
 */

import { describe, it, expect } from 'vitest';
import { severityToRisk } from './weatherRisk';
import { notamRiskForAirports } from './notam';
import { gdeltRiskForCarriers, gdeltRiskForPlaces } from './gdelt';
import { resolveRiskMaps } from './index';
import type { WeatherSeverity } from '../weather';

function wx(over: Partial<WeatherSeverity>): WeatherSeverity {
  return {
    source: 'metar', observedAt: Date.now(),
    ceilingFt: null, visibilitySm: null, windSpeedKt: null, windGustKt: null,
    hazardousPhenomena: false, precipitationMm: null,
    ...over,
  };
}

describe('weather severity maps to a graded risk', () => {
  it('no observation is zero risk', () => {
    expect(severityToRisk(null)).toBe(0);
  });

  it('clear conditions are zero risk', () => {
    expect(severityToRisk(wx({ ceilingFt: 8000, visibilitySm: 10, windGustKt: 12 }))).toBe(0);
  });

  it('a significant-weather phenomenon (thunderstorm/ash/snow) is high risk', () => {
    expect(severityToRisk(wx({ hazardousPhenomena: true }))).toBeGreaterThan(0.8);
  });

  it('a low ceiling and poor visibility raise risk', () => {
    const low = severityToRisk(wx({ ceilingFt: 300, visibilitySm: 1 }));
    expect(low).toBeGreaterThan(0.5);
    const fine = severityToRisk(wx({ ceilingFt: 2800, visibilitySm: 5 }));
    expect(fine).toBeLessThan(low);
  });

  it('strong gusts raise risk, and it never exceeds 1', () => {
    expect(severityToRisk(wx({ windGustKt: 60 }))).toBeGreaterThan(0.8);
    expect(severityToRisk(wx({ hazardousPhenomena: true, ceilingFt: 100, windGustKt: 70 }))).toBeLessThanOrEqual(1);
  });
});

describe('advisory feeds tolerate absence — off/keyless returns empty, never throws', () => {
  it('NOTAM with no FAA credentials returns an empty map', async () => {
    delete process.env.FAA_NOTAM_CLIENT_ID;
    delete process.env.FAA_NOTAM_CLIENT_SECRET;
    const m = await notamRiskForAirports(['MAA', 'DEL']);
    expect(m.size).toBe(0);
  });

  it('GDELT is off unless ZKD_LIVE_RISK=1', async () => {
    delete process.env.ZKD_LIVE_RISK;
    expect((await gdeltRiskForCarriers([{ code: 'AI', name: 'Air India' }])).size).toBe(0);
    expect((await gdeltRiskForPlaces([{ iata: 'MAA', city: 'Chennai' }])).size).toBe(0);
  });

  it('resolveRiskMaps returns all-empty maps when live risk is off (default)', async () => {
    delete process.env.ZKD_LIVE_RISK;
    delete process.env.FAA_NOTAM_CLIENT_ID;
    const maps = await resolveRiskMaps({
      airports: [{ iata: 'MAA', city: 'Chennai' }, { iata: 'DEL', city: 'Delhi' }],
      carriers: [{ code: 'AI', name: 'Air India' }],
    });
    // Off by default → no outbound calls, all maps empty, nothing thrown.
    expect(maps.weatherByAirport.size).toBe(0);
    expect(maps.advisoryByAirport.size).toBe(0);
    expect(maps.advisoryByCarrier.size).toBe(0);
  });
});
