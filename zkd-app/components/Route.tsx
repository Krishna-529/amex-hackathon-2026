import { hhmm, mins, durLabel } from '@/lib/time';

/**
 * Formatting only — turning a server-issued depISO/durationMin into HH:mm
 * strings for display isn't a decision, so doing it here (client-side) is
 * consistent with "the frontend just visualises what the backend decided."
 */
export default function RouteLine({ f }: { f: { from: string; to: string; depISO: string; durationMin: number } }) {
  const dep = new Date(f.depISO);
  const arr = mins(dep, f.durationMin);
  return (
    <div className="route">
      <div className="port"><div className="ap">{f.from}</div><div className="tm">{hhmm(dep)}</div></div>
      <div className="mid"><div className="dur">{durLabel(f.durationMin)}</div><div className="line" /></div>
      <div className="port to"><div className="ap">{f.to}</div><div className="tm">{hhmm(arr)}</div></div>
    </div>
  );
}
