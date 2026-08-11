'use client';

import { createContext, useCallback, useContext, useMemo, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { usePoll } from '@/lib/usePoll';
import type { PassengerScheduleResponse } from '@/lib/apiTypes';
import type { Consent } from '@/server/domain/types';

/**
 * This used to build an entire mock World client-side on mount and hold
 * every piece of recovery state (consent, chosen alt, pre-auth...) as local
 * React state, each device running its own independent copy. None of that
 * lives here any more — this is now a thin poller. The backend
 * (server/engine/simulation.ts) is the only thing that decides anything;
 * this provider's only job is knowing WHO is looking (the passenger
 * identity, from the `?as=` query param) and fetching THEIR view of it.
 * Recovery-specific state (a flight's phase, countdown, chosen options) is
 * polled per-page from /api/disruptions/[flightId] instead of centralized
 * here, since it's scoped to one flight, not the whole app.
 */

type Ctx = {
  passengerId: string;
  schedule: PassengerScheduleResponse | null;
  setConsent: (c: Consent) => void;
};

const WorldCtx = createContext<Ctx | null>(null);

const DEFAULT_PASSENGER = 'p-priya';

function WorldProviderInner({ children }: { children: React.ReactNode }) {
  const searchParams = useSearchParams();
  const passengerId = searchParams.get('as') ?? DEFAULT_PASSENGER;

  const { data: schedule } = usePoll<PassengerScheduleResponse>(`/api/passengers/${passengerId}/schedule`, 4000);

  const setConsent = useCallback((c: Consent) => {
    fetch(`/api/passengers/${passengerId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ consent: c }),
    }).catch(() => {});
  }, [passengerId]);

  const value = useMemo<Ctx>(() => ({ passengerId, schedule, setConsent }), [passengerId, schedule, setConsent]);

  return <WorldCtx.Provider value={value}>{children}</WorldCtx.Provider>;
}

export function WorldProvider({ children }: { children: React.ReactNode }) {
  // useSearchParams() requires a Suspense boundary since this wraps the whole
  // app in layout.tsx (a Server Component) — self-contained here.
  return (
    <Suspense fallback={null}>
      <WorldProviderInner>{children}</WorldProviderInner>
    </Suspense>
  );
}

export function useWorld() {
  const c = useContext(WorldCtx);
  if (!c) throw new Error('useWorld must be used inside WorldProvider');
  return c;
}
