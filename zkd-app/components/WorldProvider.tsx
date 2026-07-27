'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { buildWorld, type World } from '@/lib/data';
import type { Consent, PreAuth } from '@/lib/recovery';

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
    }),
    [world, consent, disrupted, chosen, rejected, settled, preAuth, prepared],
  );

  return <WorldCtx.Provider value={value}>{children}</WorldCtx.Provider>;
}

export function useWorld() {
  const c = useContext(WorldCtx);
  if (!c) throw new Error('useWorld must be used inside WorldProvider');
  return c;
}
