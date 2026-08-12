'use client';

import { useEffect, useState } from 'react';

/**
 * Polls a same-origin JSON endpoint on an interval. This is internal state
 * sync (in-memory reads on our own server) — not subject to the external
 * supplier rate limits that server/*.ts's provider clients respect; poll as
 * often as the UI needs. Pass `url: null` to pause polling (e.g. while a
 * required id isn't known yet).
 */
export function usePoll<T>(url: string | null, intervalMs: number): { data: T | null; error: boolean } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    setData(null);
    setError(false);
    if (!url) return;
    let cancelled = false;

    const tick = () => {
      fetch(url)
        .then((r) => {
          if (!r.ok) throw new Error(String(r.status));
          return r.json() as Promise<T>;
        })
        .then((json) => {
          if (!cancelled) { setData(json); setError(false); }
        })
        .catch(() => {
          if (!cancelled) setError(true);
        });
    };

    tick();
    const t = setInterval(tick, intervalMs);
    return () => { cancelled = true; clearInterval(t); };
  }, [url, intervalMs]);

  return { data, error };
}
