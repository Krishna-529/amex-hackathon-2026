import { NextRequest, NextResponse } from 'next/server';
import { AIRPORTS } from '@/lib/airports';
import { fetchMetar, weatherSeverityFromMetar } from '@/server/noaa';
import { fetchForecast, weatherSeverityFromForecast } from '@/server/openMeteo';
import { statesNear, congestionSeverity, rotationSeverity } from '@/server/opensky';
import type { SignalsResponse, SourceStatus } from '@/lib/apiTypes';

async function weatherAt(iata: string): Promise<{ v: number | null; status: SourceStatus }> {
  const ap = AIRPORTS[iata];
  if (!ap) return { v: null, status: 'empty' };

  const metar = await fetchMetar(ap.icao);
  if (metar) return { v: weatherSeverityFromMetar(metar), status: 'ok' };

  const forecast = await fetchForecast(ap.lat, ap.lon);
  if (forecast) return { v: weatherSeverityFromForecast(forecast), status: 'ok' };

  return { v: null, status: 'error' };
}

export async function GET(req: NextRequest) {
  const from = req.nextUrl.searchParams.get('from') ?? '';
  const to = req.nextUrl.searchParams.get('to') ?? '';

  const [depWeather, arrWeather, states] = await Promise.all([
    weatherAt(from),
    weatherAt(to),
    (async () => {
      const ap = AIRPORTS[from];
      if (!ap) return null;
      return statesNear(ap.lat, ap.lon);
    })(),
  ]);

  const signals: SignalsResponse['signals'] = {};
  const sources: SignalsResponse['sources'] = {
    weather: 'error',
    congestion: 'error',
    rotation: 'error',
  };

  const weatherVals = [depWeather.v, arrWeather.v].filter((v): v is number => v !== null);
  if (weatherVals.length > 0) {
    signals.weather = Math.max(...weatherVals);
    sources.weather = 'ok';
  } else if (depWeather.status === 'empty' && arrWeather.status === 'empty') {
    sources.weather = 'empty';
  }

  if (states) {
    signals.congestion = congestionSeverity(states.total);
    signals.rotation = rotationSeverity(states.onGround);
    sources.congestion = 'ok';
    sources.rotation = 'ok';
  }

  const body: SignalsResponse = { signals, sources };
  return NextResponse.json(body);
}
