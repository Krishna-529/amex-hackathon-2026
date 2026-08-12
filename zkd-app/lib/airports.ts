/** Static IATA -> ICAO/coordinates lookup for the airports used in the seeded flight data. */

export type AirportInfo = { icao: string; lat: number; lon: number; city: string; country: string };

export const AIRPORTS: Record<string, AirportInfo> = {
  MAA: { icao: 'VOMM', lat: 12.990, lon: 80.1693, city: 'Chennai', country: 'IN' },
  DEL: { icao: 'VIDP', lat: 28.5665, lon: 77.1031, city: 'Delhi', country: 'IN' },
  LHR: { icao: 'EGLL', lat: 51.4700, lon: -0.4543, city: 'London', country: 'GB' },
  BOM: { icao: 'VABB', lat: 19.0896, lon: 72.8656, city: 'Mumbai', country: 'IN' },
  CCU: { icao: 'VECC', lat: 22.6547, lon: 88.4467, city: 'Kolkata', country: 'IN' },
  BLR: { icao: 'VOBL', lat: 13.1986, lon: 77.7066, city: 'Bengaluru', country: 'IN' },
  GAU: { icao: 'VEGT', lat: 26.1061, lon: 91.5859, city: 'Guwahati', country: 'IN' },
};

export function icaoOf(iata: string): string | null {
  return AIRPORTS[iata]?.icao ?? null;
}
