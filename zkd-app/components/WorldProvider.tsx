'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { usePathname } from 'next/navigation';
import { usePoll } from '@/lib/usePoll';
import type { PassengerScheduleResponse } from '@/lib/apiTypes';
import type { Consent } from '@/server/domain/types';

/**
 * This used to build an entire mock World client-side on mount and hold
 * every piece of recovery state (consent, chosen alt, pre-auth...) as local
 * React state, each device running its own independent copy. None of that
 * lives here any more — this is now a thin poller. The backend
 * (server/engine/simulation.ts) is the only thing that decides anything;
 * this provider's only job is knowing WHO is looking and fetching THEIR
 * view of it.
 *
 * WHO used to come from a `?as=` query param — anyone could view or act as
 * anyone by editing the URL. It now comes from the signed-in session
 * (GET /api/auth/me), fetched once and never polled: a stale "who am I"
 * would defeat sign-out. Recovery-specific state (a flight's phase,
 * countdown, chosen options) is polled per-page from
 * /api/disruptions/[flightId] instead of centralized here, since it's
 * scoped to one flight, not the whole app.
 */

type AuthStatus = 'loading' | 'authenticated' | 'anonymous';

type Ctx = {
  status: AuthStatus;
  passengerId: string | null;
  displayName: string | null;
  schedule: PassengerScheduleResponse | null;
  setConsent: (c: Consent) => void;
  signOut: () => void;
};

const WorldCtx = createContext<Ctx | null>(null);

// Pages an anonymous visitor may reach without being bounced to /login.
// /ops has no account of its own — that is the point of it staying open.
const PUBLIC_PATHS = new Set(['/', '/login', '/ops']);

export function WorldProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [passengerId, setPassengerId] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/auth/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((json: { id: string; displayName: string } | null) => {
        if (cancelled) return;
        if (json) {
          setPassengerId(json.id);
          setDisplayName(json.displayName);
          setStatus('authenticated');
        } else {
          setStatus('anonymous');
        }
      })
      .catch(() => { if (!cancelled) setStatus('anonymous'); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (status !== 'anonymous') return;
    if (PUBLIC_PATHS.has(pathname)) return;
    window.location.assign('/login');
  }, [status, pathname]);

  const { data: schedule } = usePoll<PassengerScheduleResponse>(
    passengerId ? `/api/passengers/${passengerId}/schedule` : null,
    4000,
  );

  const setConsent = useCallback((c: Consent) => {
    if (!passengerId) return;
    fetch(`/api/passengers/${passengerId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ consent: c }),
    }).catch(() => {});
  }, [passengerId]);

  const signOut = useCallback(() => {
    fetch('/api/auth/logout', { method: 'POST' })
      .finally(() => window.location.assign('/login'));
  }, []);

  const value = useMemo<Ctx>(
    () => ({ status, passengerId, displayName, schedule: schedule ?? null, setConsent, signOut }),
    [status, passengerId, displayName, schedule, setConsent, signOut],
  );

  return <WorldCtx.Provider value={value}>{children}</WorldCtx.Provider>;
}

export function useWorld() {
  const c = useContext(WorldCtx);
  if (!c) throw new Error('useWorld must be used inside WorldProvider');
  return c;
}
