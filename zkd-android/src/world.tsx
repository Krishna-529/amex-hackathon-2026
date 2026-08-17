import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { usePoll } from './lib/usePoll';
import { hhmm } from './lib/time';
import { API_BASE_URL } from './config';
import { notifyCancelled, getPushToken } from './notify';
import { fetchMe, login as apiLogin, logout as apiLogout, setConsentRemote, type Consent, type PassengerScheduleResponse, registerDevice } from './api';

/**
 * No mock World built on mount — this is a thin poller of the same
 * server-authoritative engine every web tab reads (server/engine/simulation.ts).
 *
 * Identity used to be a hardcoded DEFAULT_PASSENGER_ID: the phone always
 * looked at one seeded passenger, no login at all. It now comes from the same
 * signed-in session the web app uses (GET /api/auth/me) — the phone has its
 * own LoginScreen (see App.tsx) rather than an identity switcher, because
 * there is nothing to switch between any more: whoever is signed in on this
 * phone is the only passenger it can see or act as.
 */

export type AuthStatus = 'loading' | 'authenticated' | 'anonymous';

type Ctx = {
  status: AuthStatus;
  passengerId: string | null;
  displayName: string | null;
  schedule: PassengerScheduleResponse | null;
  setConsent: (c: Consent) => void;
  signIn: (email: string, password: string) => Promise<string | null>;
  signOut: () => void;
};

const WorldCtx = createContext<Ctx | null>(null);

export function WorldProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [passengerId, setPassengerId] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState<string | null>(null);

  const applyMe = useCallback((me: { id: string; displayName: string } | null) => {
    if (me) {
      setPassengerId(me.id);
      setDisplayName(me.displayName);
      setStatus('authenticated');
    } else {
      setPassengerId(null);
      setDisplayName(null);
      setStatus('anonymous');
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchMe().then((me) => { if (!cancelled) applyMe(me); });
    return () => { cancelled = true; };
  }, [applyMe]);

  const signIn = useCallback(async (email: string, password: string): Promise<string | null> => {
    const result = await apiLogin(email, password);
    if ('error' in result) return result.error;
    applyMe(result);
    return null;
  }, [applyMe]);

  const signOut = useCallback(() => {
    apiLogout().finally(() => applyMe(null));
  }, [applyMe]);

  // Register this device for remote push, once, as soon as there is a session
  // to attach it to. Deliberately keyed on passengerId rather than run on mount:
  // POST /api/devices binds the token to the signed-in passenger, so calling it
  // before sign-in just 401s. Re-runs on a different passenger so a shared demo
  // phone does not keep delivering the previous member's alerts.
  const registeredFor = useRef<string | null>(null);
  useEffect(() => {
    if (!passengerId || registeredFor.current === passengerId) return;
    registeredFor.current = passengerId;
    getPushToken()
      .then((token) => (token ? registerDevice(token) : false))
      .catch(() => false);
  }, [passengerId]);

  const schedule = usePoll<PassengerScheduleResponse>(
    passengerId ? `${API_BASE_URL}/api/passengers/${passengerId}/schedule` : null,
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
    if (!passengerId) return;
    setConsentRemote(passengerId, c);
  }, [passengerId]);

  const value = useMemo<Ctx>(
    () => ({ status, passengerId, displayName, schedule, setConsent, signIn, signOut }),
    [status, passengerId, displayName, schedule, setConsent, signIn, signOut],
  );

  return <WorldCtx.Provider value={value}>{children}</WorldCtx.Provider>;
}

export function useWorld() {
  const c = useContext(WorldCtx);
  if (!c) throw new Error('useWorld must be used inside WorldProvider');
  return c;
}
