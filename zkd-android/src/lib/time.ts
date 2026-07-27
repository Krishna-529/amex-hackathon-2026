/**
 * Everything is derived from the real clock so the disruption is always
 * happening right now. All of it takes `now` explicitly — nothing reads the
 * clock at module scope, because that would differ between the server render
 * and the client render and blow up hydration.
 */

export const mins = (d: Date, m: number) => new Date(d.getTime() + m * 60_000);
export const days = (d: Date, n: number) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};
export const hhmm = (d: Date) =>
  `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
export const hhmmss = (d: Date) => `${hhmm(d)}:${String(d.getSeconds()).padStart(2, '0')}`;
export const ddMon = (d: Date) =>
  `${d.getDate()} ${d.toLocaleString('en-GB', { month: 'short' })}`;

const midnight = (d: Date) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};

export function dayLabel(d: Date, now: Date) {
  const diff = Math.round((midnight(d).getTime() - midnight(now).getTime()) / 86_400_000);
  if (diff === 0) return `Today, ${ddMon(d)}`;
  if (diff === 1) return `Tomorrow, ${ddMon(d)}`;
  if (diff === -1) return 'Yesterday';
  return ddMon(d) + (d.getFullYear() !== now.getFullYear() ? ` ${d.getFullYear()}` : '');
}

export function agoLabel(d: Date, now: Date) {
  const s = Math.max(0, Math.round((now.getTime() - d.getTime()) / 1000));
  if (s < 60) return `${s} seconds ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} ${m === 1 ? 'minute' : 'minutes'} ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} ${h === 1 ? 'hour' : 'hours'} ago`;
  const dd = Math.round(h / 24);
  if (dd < 14) return `${dd} ${dd === 1 ? 'day' : 'days'} ago`;
  if (dd < 70) return `${Math.round(dd / 7)} weeks ago`;
  const mo = Math.round(dd / 30);
  if (mo < 18) return `${mo} months ago`;
  const y = (dd / 365).toFixed(1).replace('.0', '');
  return `${y} ${y === '1' ? 'year' : 'years'} ago`;
}

export const durLabel = (m: number) =>
  `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;

/** seconds, printed the way an engineer would read a latency budget */
export const secs = (n: number) =>
  `${(n < 1 ? n.toFixed(2) : n.toFixed(1)).replace(/\.0$/, '')}s`;

export const money = (n: number) => (n ? `₹${n.toLocaleString('en-IN')}` : '₹0');
