'use client';

import { Suspense } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { usePoll } from '@/lib/usePoll';
import { useWorld } from './WorldProvider';

type PassengerRow = { id: string; displayName: string; consent: string };

/**
 * The concrete proof that "multiple devices, multiple users" is real and not
 * just a claim: open the app in two tabs (or a phone + laptop) with different
 * ?as= values and watch them show genuinely different, independently-synced
 * schedules and recoveries — same backend, different passengers.
 */
function PassengerSwitcherInner() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { passengerId } = useWorld();
  const { data: passengers } = usePoll<PassengerRow[]>('/api/passengers', 8000);

  const onChange = (id: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('as', id);
    router.push(`${pathname}?${params.toString()}`);
  };

  return (
    <select
      className="passenger-switcher"
      value={passengerId}
      onChange={(e) => onChange(e.target.value)}
      aria-label="Viewing as"
    >
      {(passengers ?? []).map((p) => (
        <option key={p.id} value={p.id}>{p.displayName}</option>
      ))}
    </select>
  );
}

export default function PassengerSwitcher() {
  return (
    <Suspense fallback={null}>
      <PassengerSwitcherInner />
    </Suspense>
  );
}
