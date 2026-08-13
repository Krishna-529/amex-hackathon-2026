import { useEffect, useState } from 'react';

/** Generic polling hook — the phone's only way of finding anything out. */
export function usePoll<T>(url: string | null, intervalMs: number): T | null {
  const [data, setData] = useState<T | null>(null);

  useEffect(() => {
    setData(null);
    if (!url) return;
    let cancelled = false;
    const tick = () => {
      // credentials: 'include' — explicit rather than assumed, see the same
      // comment in src/api.ts's getJSON/postJSON for why.
      fetch(url, { credentials: 'include' })
        .then((r) => (r.ok ? (r.json() as Promise<T>) : Promise.reject(r.status)))
        .then((json) => { if (!cancelled) setData(json); })
        .catch(() => {});
    };
    tick();
    const t = setInterval(tick, intervalMs);
    return () => { cancelled = true; clearInterval(t); };
  }, [url, intervalMs]);

  return data;
}
