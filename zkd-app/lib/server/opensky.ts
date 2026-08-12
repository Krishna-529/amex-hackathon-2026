import { getOrSet } from './cache';

/**
 * OpenSky gives real-time ADS-B position data, not schedules — it cannot do true
 * tail-number rotation linkage (that needs FlightAware/Cirium, out of scope here).
 * `statesNear` is used two ways: raw aircraft count near an airport as a congestion
 * proxy, and on-ground count as a proxy for inbound-traffic backlog ("rotation") —
 * not genuine rotation delay. Callers should treat it as an honest proxy, not fact.
 */

async function getOpenSkyToken(): Promise<string | null> {
  const clientId = process.env.OPENSKY_CLIENT_ID;
  const clientSecret = process.env.OPENSKY_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  return getOrSet('opensky:token', 28 * 60 * 1000, async () => {
    const res = await fetch(
      'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: clientId,
          client_secret: clientSecret,
        }),
        cache: 'no-store',
      },
    );
    if (!res.ok) throw new Error(`opensky token ${res.status}`);
    const json = (await res.json()) as { access_token: string };
    return json.access_token;
  }).catch(() => null);
}

export async function statesNear(
  lat: number,
  lon: number,
  radiusDeg = 0.6,
): Promise<{ total: number; onGround: number } | null> {
  try {
    const token = await getOpenSkyToken();
    if (!token) return null;

    const params = new URLSearchParams({
      lamin: String(lat - radiusDeg),
      lomin: String(lon - radiusDeg),
      lamax: String(lat + radiusDeg),
      lomax: String(lon + radiusDeg),
    });
    const res = await fetch(`https://opensky-network.org/api/states/all?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { states: unknown[][] | null };
    const states = json.states ?? [];
    const onGround = states.filter((s) => s[8] === true).length;
    return { total: states.length, onGround };
  } catch {
    return null;
  }
}

export function congestionSeverity(total: number): number {
  return Math.max(0, Math.min(1, total / 35));
}

export function rotationSeverity(onGround: number): number {
  return Math.max(0, Math.min(1, onGround / 20));
}
