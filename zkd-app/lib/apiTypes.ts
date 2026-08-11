import type { Signals } from './risk';
import type { Alt, HotelOpt } from './data';

export type SourceStatus = 'ok' | 'empty' | 'error';

export type SignalsResponse = {
  signals: Partial<Signals>;
  sources: { weather: SourceStatus; congestion: SourceStatus; rotation: SourceStatus };
};

export type FlightStatusResponse = {
  status: SourceStatus;
  match: null | { flightStatus: string; depDelayMin: number | null; arrDelayMin: number | null };
};

export type AltsResponse = {
  alts: Alt[];
  sources: { duffel: SourceStatus; sabre: SourceStatus };
};

export type HotelsResponse = {
  hotels: HotelOpt[];
  source: SourceStatus;
};

export type ExplainRequest =
  | { kind: 'risk'; flightCode: string; from: string; to: string; pct: number; topFactor: string }
  | { kind: 'alt'; flightCode: string; altCode: string; fare: number; cabin: string };

export type ExplainResponse = { text: string | null };
