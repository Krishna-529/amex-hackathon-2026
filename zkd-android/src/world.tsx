import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { buildWorld, type World } from './lib/data';
import type { Consent } from './lib/recovery';

type Settled = 'none' | 'booked' | 'handed-over';

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
  /** how the recovery resolved, so the flights list can reflect it */
  settled: Settled;
  setSettled: (s: Settled) => void;
};

const WorldCtx = createContext<Ctx | null>(null);

export function WorldProvider({ children }: { children: React.ReactNode }) {
  // Built exactly once, on mount. Every time in the app is relative to this
  // `now`, so the cancellation always reads as having just happened — and
  // rebuilding it on a re-render would make the clock jump under the user.
  const [world, setWorld] = useState<World | null>(null);
  const [consent, setConsent] = useState<Consent>('autopilot');
  const [disrupted, setDisrupted] = useState(false);
  const [chosen, setChosen] = useState('a1');
  const [rejected, setRejected] = useState<string[]>([]);
  const [settled, setSettled] = useState<Settled>('none');

  useEffect(() => {
    setWorld(buildWorld(new Date()));
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
    }),
    [world, consent, disrupted, chosen, rejected, settled],
  );

  return <WorldCtx.Provider value={value}>{children}</WorldCtx.Provider>;
}

export function useWorld() {
  const c = useContext(WorldCtx);
  if (!c) throw new Error('useWorld must be used inside WorldProvider');
  return c;
}
