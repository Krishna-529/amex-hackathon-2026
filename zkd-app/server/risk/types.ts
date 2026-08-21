/**
 * Shared types for live disruption-risk signals fed into the alternate-flight
 * ranker.
 *
 * The ~250 disruption causes collapse into a small number of graded, real-time
 * signals keyed to the things a candidate replacement actually touches — its
 * airports, its route, its carrier. Each provider (weather, NOTAM, news) returns
 * a severity in [0,1] per key; the ranker consumes the worst signal touching a
 * candidate as two features (weatherRisk, advisoryRisk). Nothing here is a hard
 * filter — severe signals are heavily weighted but overridable (see the ranker).
 */

/** 0 = no known risk, 1 = as bad as this channel reports. */
export type RiskSeverity = number;

export type RiskCategory =
  | 'weather'
  | 'airspace'   // NOTAM: closures, GPS/navaid outage, military/VIP
  | 'security'
  | 'strike'
  | 'geopolitical'
  | 'other';

/** Risk keyed by IATA airport code. */
export type AirportRisk = Map<string, RiskSeverity>;
/** Risk keyed by IATA carrier code. */
export type CarrierRisk = Map<string, RiskSeverity>;

/**
 * Everything the ranker needs to compute a candidate's weatherRisk and
 * advisoryRisk, resolved ONCE per recovery (batched over unique airports and
 * carriers) rather than per candidate. Every map degrades to "absent" — a key
 * with no entry is treated as zero risk, never as a blocker.
 */
export type RiskMaps = {
  weatherByAirport: AirportRisk;
  advisoryByAirport: AirportRisk;
  advisoryByCarrier: CarrierRisk;
};

export function emptyRiskMaps(): RiskMaps {
  return { weatherByAirport: new Map(), advisoryByAirport: new Map(), advisoryByCarrier: new Map() };
}
