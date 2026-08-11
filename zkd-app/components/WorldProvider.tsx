'use client';

import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { buildWorld, type World, type Alt, type HotelOpt } from '@/lib/data';
import type { Consent, PreAuth } from '@/lib/recovery';
import type { Signals } from '@/lib/risk';
import type {
  SignalsResponse,
  FlightStatusResponse,
  AltsResponse,
  HotelsResponse,
  ExplainRequest,
  DisruptionResolution,
  DisruptionStateResponse,
} from '@/lib/apiTypes';

type LiveEntry<T> = { status: 'idle' | 'loading' | 'ok' | 'error'; data?: T };

/**
 * Real API data, kept separate from `world` rather than merged into it — this
 * way `buildWorld()`/`risk()` never change, and the app renders exactly what it
 * renders today if every live call fails. Pages merge `{...mockDefaults, ...live}`
 * themselves at render time.
 */
type LiveState = {
  signals: Record<string, LiveEntry<Partial<Signals>>>;
  flightStatus: Record<string, LiveEntry<FlightStatusResponse['match']>>;
  alts: LiveEntry<Alt[]>;
  hotels: LiveEntry<HotelOpt[]>;
  explain: Record<string, LiveEntry<string>>;
  /** the server-authoritative "when did this land, and how was it resolved" record — see server/disruptionState.ts */
  disruption: Record<string, LiveEntry<DisruptionStateResponse>>;
};

const emptyLive: LiveState = {
  signals: {},
  flightStatus: {},
  alts: { status: 'idle' },
  hotels: { status: 'idle' },
  explain: {},
  disruption: {},
};

type Ctx = {
  world: World | null;
  consent: Consent;
  setConsent: (c: Consent) => void;
  /** has the cancellation landed yet in this session */
  disrupted: boolean;
  setDisrupted: (v: boolean) => void;
  /** which alternative is currently selected */
  chosen: string;
  setChosen: (id: string) => void;
  /** offers the member has explicitly rejected — never re-proposed */
  rejected: string[];
  reject: (id: string) => void;
  /** how the recovery resolved, so the dashboard can reflect it */
  settled: 'none' | 'booked' | 'handed-over';
  setSettled: (s: Ctx['settled']) => void;
  /** a decision the member gave us BEFORE the cancellation */
  preAuth: PreAuth | null;
  setPreAuth: (p: PreAuth | null) => void;
  /** has the member been through the early ask, either way */
  prepared: boolean;
  setPrepared: (v: boolean) => void;
  /** real external API data — on-demand only, never polled */
  live: LiveState;
  refreshSignals: (flightId: string, from: string, to: string) => void;
  refreshFlightStatus: (flightId: string, flightIata: string) => void;
  refreshAlts: (from: string, to: string, date: string, cabin?: string) => void;
  refreshHotels: (city: string, checkin: string, checkout: string) => void;
  explainRisk: (flightId: string, req: Extract<ExplainRequest, { kind: 'risk' }>) => void;
  explainAlt: (altId: string, req: Extract<ExplainRequest, { kind: 'alt' }>) => void;
  /** Fetches the canonical detectedAt/resolution for a flight so every viewer's countdown agrees. */
  refreshDisruption: (flightId: string) => void;
  /**
   * Reports what happened (autopilot fired / member approved / member handed over).
   * First report for a flight wins server-side — the promise always resolves to
   * whatever actually became canonical, which may not be what THIS client sent if
   * another device got there first, so callers must reconcile against the result,
   * not assume their own action stuck.
   */
  resolveDisruption: (flightId: string, resolution: DisruptionResolution) => Promise<DisruptionStateResponse>;
};

const WorldCtx = createContext<Ctx | null>(null);

export function WorldProvider({ children }: { children: React.ReactNode }) {
  // The world is clock-derived, so it must be built on the client only —
  // building it during SSR would render a different time than hydration.
  const [world, setWorld] = useState<World | null>(null);
  // Consent is a member setting, so it has to outlive a page load — otherwise
  // deep-linking straight to /recovery silently reverts them to autopilot.
  const [consent, setConsentState] = useState<Consent>('autopilot');
  const setConsent = (c: Consent) => {
    setConsentState(c);
    try { localStorage.setItem('zkd.consent', c); } catch {}
  };
  const [disrupted, setDisrupted] = useState(false);
  const [chosen, setChosen] = useState('a1');
  const [rejected, setRejected] = useState<string[]>([]);
  const [settled, setSettled] = useState<Ctx['settled']>('none');
  // A pre-authorisation is an instruction the member actually gave us. It has to
  // survive a reload for the same reason consent does — losing it silently would
  // downgrade them to being asked in a hurry, which is the thing it exists to avoid.
  const [preAuth, setPreAuthState] = useState<PreAuth | null>(null);
  const [prepared, setPreparedState] = useState(false);
  const setPreAuth = (v: PreAuth | null) => {
    setPreAuthState(v);
    try {
      if (v) localStorage.setItem('zkd.preauth', JSON.stringify(v));
      else localStorage.removeItem('zkd.preauth');
    } catch {}
  };
  const setPrepared = (v: boolean) => {
    setPreparedState(v);
    try { localStorage.setItem('zkd.prepared', v ? '1' : '0'); } catch {}
  };

  const [live, setLive] = useState<LiveState>(emptyLive);
  // Client-side half of "never call twice per session" — the server-side half is
  // the TTL cache in lib/server/cache.ts. Also guards against React Strict Mode's
  // dev-mode double-invoke of effects.
  const startedRef = useRef(new Set<string>());

  const refreshSignals = (flightId: string, from: string, to: string) => {
    const key = `signals:${flightId}`;
    if (startedRef.current.has(key)) return;
    startedRef.current.add(key);
    setLive((l) => ({ ...l, signals: { ...l.signals, [flightId]: { status: 'loading' } } }));
    fetch(`/api/signals?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)
      .then((r) => r.json() as Promise<SignalsResponse>)
      .then((json) =>
        setLive((l) => ({
          ...l,
          signals: { ...l.signals, [flightId]: { status: 'ok', data: json.signals } },
        })),
      )
      .catch(() =>
        setLive((l) => ({ ...l, signals: { ...l.signals, [flightId]: { status: 'error' } } })),
      );
  };

  const refreshFlightStatus = (flightId: string, flightIata: string) => {
    const key = `flightStatus:${flightId}`;
    if (startedRef.current.has(key)) return;
    startedRef.current.add(key);
    setLive((l) => ({ ...l, flightStatus: { ...l.flightStatus, [flightId]: { status: 'loading' } } }));
    fetch(`/api/flight-status?flightIata=${encodeURIComponent(flightIata)}`)
      .then((r) => r.json() as Promise<FlightStatusResponse>)
      .then((json) =>
        setLive((l) => ({
          ...l,
          flightStatus: { ...l.flightStatus, [flightId]: { status: 'ok', data: json.match } },
        })),
      )
      .catch(() =>
        setLive((l) => ({
          ...l,
          flightStatus: { ...l.flightStatus, [flightId]: { status: 'error' } },
        })),
      );
  };

  const refreshAlts = (from: string, to: string, date: string, cabin?: string) => {
    if (startedRef.current.has('alts')) return;
    startedRef.current.add('alts');
    setLive((l) => ({ ...l, alts: { status: 'loading' } }));
    const q = new URLSearchParams({ from, to, date, ...(cabin ? { cabin } : {}) });
    fetch(`/api/alts?${q}`)
      .then((r) => r.json() as Promise<AltsResponse>)
      .then((json) => setLive((l) => ({ ...l, alts: { status: 'ok', data: json.alts } })))
      .catch(() => setLive((l) => ({ ...l, alts: { status: 'error' } })));
  };

  const refreshHotels = (city: string, checkin: string, checkout: string) => {
    if (startedRef.current.has('hotels')) return;
    startedRef.current.add('hotels');
    setLive((l) => ({ ...l, hotels: { status: 'loading' } }));
    const q = new URLSearchParams({ city, checkin, checkout });
    fetch(`/api/hotels?${q}`)
      .then((r) => r.json() as Promise<HotelsResponse>)
      .then((json) => setLive((l) => ({ ...l, hotels: { status: 'ok', data: json.hotels } })))
      .catch(() => setLive((l) => ({ ...l, hotels: { status: 'error' } })));
  };

  // `id` is the dict key pages read (`live.explain['risk:u1']` / `live.explain['alt:a1']`);
  // it also doubles as the dedup key so the same explanation is never fetched twice.
  const runExplain = (id: string, req: ExplainRequest) => {
    if (startedRef.current.has(id)) return;
    startedRef.current.add(id);
    setLive((l) => ({ ...l, explain: { ...l.explain, [id]: { status: 'loading' } } }));
    fetch('/api/explain', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    })
      .then((r) => r.json() as Promise<{ text: string | null }>)
      .then((json) =>
        setLive((l) => ({
          ...l,
          explain: { ...l.explain, [id]: json.text ? { status: 'ok', data: json.text } : { status: 'error' } },
        })),
      )
      .catch(() => setLive((l) => ({ ...l, explain: { ...l.explain, [id]: { status: 'error' } } })));
  };
  const explainRisk = (flightId: string, req: Extract<ExplainRequest, { kind: 'risk' }>) =>
    runExplain(`risk:${flightId}`, req);
  const explainAlt = (altId: string, req: Extract<ExplainRequest, { kind: 'alt' }>) =>
    runExplain(`alt:${altId}`, req);

  const refreshDisruption = (flightId: string) => {
    const key = `disruption:${flightId}`;
    if (startedRef.current.has(key)) return;
    startedRef.current.add(key);
    setLive((l) => ({ ...l, disruption: { ...l.disruption, [flightId]: { status: 'loading' } } }));
    fetch(`/api/disruption?flightId=${encodeURIComponent(flightId)}`)
      .then((r) => r.json() as Promise<DisruptionStateResponse>)
      .then((json) =>
        setLive((l) => ({ ...l, disruption: { ...l.disruption, [flightId]: { status: 'ok', data: json } } })),
      )
      .catch(() =>
        setLive((l) => ({ ...l, disruption: { ...l.disruption, [flightId]: { status: 'error' } } })),
      );
  };

  const resolveDisruption = (
    flightId: string,
    resolution: DisruptionResolution,
  ): Promise<DisruptionStateResponse> =>
    fetch('/api/disruption', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ flightId, resolution }),
    })
      .then((r) => r.json() as Promise<DisruptionStateResponse>)
      .then((json) => {
        setLive((l) => ({ ...l, disruption: { ...l.disruption, [flightId]: { status: 'ok', data: json } } }));
        return json;
      });

  useEffect(() => {
    setWorld(buildWorld(new Date()));
    try {
      const saved = localStorage.getItem('zkd.consent');
      if (saved === 'autopilot' || saved === 'ask') setConsentState(saved);
      const pa = localStorage.getItem('zkd.preauth');
      if (pa) setPreAuthState(JSON.parse(pa) as PreAuth);
      if (localStorage.getItem('zkd.prepared') === '1') setPreparedState(true);
    } catch {}
  }, []);

  const value = useMemo<Ctx>(
    () => ({
      world,
      consent,
      setConsent,
      disrupted,
      setDisrupted,
      chosen,
      setChosen,
      rejected,
      reject: (id) => setRejected((r) => (r.includes(id) ? r : [...r, id])),
      settled,
      setSettled,
      preAuth,
      setPreAuth,
      prepared,
      setPrepared,
      live,
      refreshSignals,
      refreshFlightStatus,
      refreshAlts,
      refreshHotels,
      explainRisk,
      explainAlt,
      refreshDisruption,
      resolveDisruption,
    }),
    [world, consent, disrupted, chosen, rejected, settled, preAuth, prepared, live],
  );

  return <WorldCtx.Provider value={value}>{children}</WorldCtx.Provider>;
}

export function useWorld() {
  const c = useContext(WorldCtx);
  if (!c) throw new Error('useWorld must be used inside WorldProvider');
  return c;
}
