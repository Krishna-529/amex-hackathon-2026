'use client';

import Link from 'next/link';
import type { PastFlight } from '@/server/domain/types';
import { OUTCOME } from '@/lib/outcome';
import Pill from '@/components/Pill';

export default function HistoryTable({ rows }: { rows: PastFlight[] }) {
  return (
    <div className="g" style={{ overflow: 'hidden' }}>
      <table className="tbl">
        <thead>
          <tr><th>Flight</th><th>Route</th><th>Date</th><th className="ar">Outcome</th></tr>
        </thead>
        <tbody>
          {rows.map((f) => {
            const o = OUTCOME[f.outcome];
            return (
              <tr key={f.id} onClick={() => { window.location.href = `/flights/${f.id}`; }}>
                <td className="fc"><Link href={`/flights/${f.id}`}>{f.code}</Link></td>
                <td className="rt">
                  {f.from} → {f.to}<span style={{ color: 'var(--mist2)' }}> · {f.dep}</span>
                </td>
                <td className="dt">{f.date}<span className="exact">{f.exact}</span></td>
                <td className="ar"><Pill tone={o.cls}>{o.label}</Pill></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
