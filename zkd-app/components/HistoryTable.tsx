'use client';

import Link from 'next/link';
import type { PastFlight } from '@/server/domain/types';
import { OUTCOME } from '@/lib/outcome';
import Pill from '@/components/Pill';

/**
 * Cards, not a table — matches the /flights upcoming-list card style
 * (.uprow/.route/.foot) so history and upcoming flights read as one visual
 * language instead of a table next to a row-list.
 */
export default function HistoryTable({ rows }: { rows: PastFlight[] }) {
  return (
    <div className="up-list">
      {rows.map((f) => (
        <Link key={f.id} href={`/flights/${f.id}`} className="uprow">
          <div style={{ minWidth: 0 }}>
            <div className="meta">
              <span className="code">{f.code}</span>
              <span className="when">{f.date}</span>
            </div>
            <div className="route">
              <div className="port"><div className="ap">{f.from}</div><div className="tm">{f.dep}</div></div>
              <div className="mid"><div className="dur">{f.dur}</div><div className="line" /></div>
              <div className="port to"><div className="ap">{f.to}</div><div className="tm">{f.arr}</div></div>
            </div>
            <div className="foot">
              <Pill tone={OUTCOME[f.outcome].cls}>{OUTCOME[f.outcome].label}</Pill>
              <span>{f.exact}</span>
              {f.recovered && <span>· {f.recovered}</span>}
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}
