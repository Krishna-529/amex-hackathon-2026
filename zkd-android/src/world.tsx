import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef } from 'react';
import { usePoll } from './lib/usePoll';
import { hhmm } from './lib/time';
import { API_BASE_URL } from './config';
import { notifyCancelled } from './notify';
import { setConsentRemote, type Consent, type PassengerScheduleResponse } from './api';

/**
 * No mock World built on mount any more — this is a thin poller of the same
 * server-authoritative engine every web tab reads (server/engine/simulation.ts).
 * The phone has no identity switcher UI like the web app's ?as=; it always
 * looks at one seeded passenger, same as picking up one specific member's
 * phone in the demo.
 */
export const DEFAULT_PASSENGER_ID = 'p-priya';

type Ctx = {
  passengerId: string;
  schedule: PassengerScheduleResponse | null;
  setConsent: (c: Consent) => void;
};

const WorldCtx = createContext<Ctx | null>(null);

export function WorldProvider({ children }: { children: React.ReactNode }) {
  const passengerId = DEFAULT_PASSENGER_ID;
  const schedule = usePoll<PassengerScheduleResponse>(
    `${API_BASE_URL}/api/passengers/${passengerId}/schedule`,
    4000,
  );

  // A real notification the moment ANY flight on this schedule flips out of
  // 'none' — this is the phone noticing a change the backend already made,
  // not a local timer standing in for detection. `null` means "haven't seen
  // a first poll yet", so a flight that's already disrupted when the app
  // opens doesn't fire a false notification.
  const seenPhases = useRef<Record<string, string> | null>(null);
  useEffect(() => {
    if (!schedule) return;
    const isFirst = seenPhases.current === null;
    const next: Record<string, string> = {};
    for (const f of schedule.upcoming) {
      next[f.id] = f.disruptionPhase;
      if (!isFirst) {
        const prev = seenPhases.current![f.id] ?? 'none';
        if (prev === 'none' && f.disruptionPhase !== 'none') {
          notifyCancelled(f.id, f.code, hhmm(new Date(f.depISO)), schedule.passenger.consent === 'autopilot').catch(() => {});
        }
      }
    }
    seenPhases.current = next;
  }, [schedule]);

  const setConsent = useCallback((c: Consent) => {
    setConsentRemote(passengerId, c);
  }, [passengerId]);

  const value = useMemo<Ctx>(
    () => ({ passengerId, schedule, setConsent }),
    [passengerId, schedule, setConsent],
  );

  return <WorldCtx.Provider value={value}>{children}</WorldCtx.Provider>;
}

export function useWorld() {
  const c = useContext(WorldCtx);
  if (!c) throw new Error('useWorld must be used inside WorldProvider');
  return c;
}
