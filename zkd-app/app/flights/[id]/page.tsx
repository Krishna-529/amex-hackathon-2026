'use client';

import Link from 'next/link';
import { use } from 'react';
import { notFound } from 'next/navigation';
import { useWorld } from '@/components/WorldProvider';
import RouteLine from '@/components/Route';
import { usePoll } from '@/lib/usePoll';
import { risk, BAND_LABEL, BAND_SAY, bandOf } from '@/lib/risk';
import { OUTCOME } from '@/lib/outcome';
import { hhmm, mins, dayLabel, money } from '@/lib/time';
import type { FlightDetail } from '@/lib/apiTypes';
import type { PastFlight } from '@/server/domain/types';

const RING = 2 * Math.PI * 92;

function routeRecord(past: PastFlight[], from: string, to: string) {
  const rows = past.filter((p) => p.from === from && p.to === to);
  return { flown: rows.length, cancelled: rows.filter((p) => p.outcome === 'cancelled').length };
}

export default function FlightPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { schedule } = useWorld();

  const upcoming = schedule?.upcoming.find((x) => x.id === id);
  const past = schedule?.past.find((x) => x.id === id);

  // Only upcoming flights have live candidates/signals — past flights are a
  // frozen record, no point polling detail for them.
  const { data: detail } = usePoll<FlightDetail>(upcoming ? `/api/flights/${id}` : null, 5000);

  if (!schedule) return <div className="page-h"><h1>Loading your flight</h1></div>;
  if (!upcoming && !past) notFound();

  const routeOf = upcoming ?? past!;
  const rec = routeRecord(schedule.past, routeOf.from, routeOf.to);

  if (past) {
    const o = OUTCOME[past.outcome];
    const tone = past.outcome === 'ontime' ? 'ok' : past.outcome === 'delayed' ? 'warn' : 'bad';
    return (
      <div className="skeleton">
        <Link href="/flights" className="back">← All flights</Link>
        <div className="page-h" style={{ padding: '0 0 30px' }}>
          <h1>{past.code} · {past.from} → {past.to}</h1>
          <p>{past.date} · {past.dep} – {past.arr}</p>
        </div>
        <div className="split">
          <div className="g panel">
            <h3>What happened</h3>
            <div className="kv"><span className="k">Outcome</span><span className={`v ${tone}`}>{o.label}</span></div>
            <div className="kv"><span className="k">Detail</span><span className="v">{past.detail}</span></div>
            <div className="kv">
              <span className="k">You&apos;ve flown {past.from}→{past.to}</span>
              <span className="v">{rec.flown}× · {rec.cancelled} cancelled</span>
            </div>
          </div>
          {past.recovered ? (
            <div className="g plan"><h3>What we did</h3><p>{past.recovered}</p></div>
          ) : (
            <div className="g panel">
              <h3>Notes</h3>
              <p style={{ margin: 0, color: 'var(--mist)', fontSize: 13.5 }}>Nothing needed doing on this one.</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  const f = upcoming!;
  const dep = new Date(f.depISO);
  const arr = mins(dep, f.durationMin);

  const head = (
    <>
      <Link href="/flights" className="back">← All flights</Link>
      <div className="page-h" style={{ padding: '0 0 30px' }}>
        <h1>{f.code} · {f.from} → {f.to}</h1>
        <p>{dayLabel(dep, new Date())}{f.aircraft ? ` · ${f.aircraft}` : ''} · {hhmm(dep)} – {hhmm(arr)}</p>
      </div>
      <div className="g panel" style={{ marginBottom: 16 }}><RouteLine f={f} /></div>
    </>
  );

  if (f.disruptionPhase !== 'none') {
    return (
      <div className="skeleton">
        {head}
        <div className="g panel">
          <h3>This flight was cancelled</h3>
          <p style={{ margin: '0 0 16px', color: 'var(--mist)', fontSize: 13.5 }}>
            We&apos;ve already rebuilt your trip around it.
          </p>
          <Link href={`/recovery/${f.id}`} className="cta" style={{ display: 'flex' }}>View the recovery →</Link>
        </div>
      </div>
    );
  }

  if (!detail) return <div className="skeleton">{head}<div className="page-h"><h1>Loading risk detail…</h1></div></div>;

  const r = risk(detail.signals);
  const stops =
    r.band === 'high' ? ['#ff9aa9', 'var(--risk)']
      : r.band === 'mid' ? ['#ffd98a', 'var(--warn)']
        : ['#7cf0c0', 'var(--safe)'];
  const usableAlts = detail.candidates.alts.filter((a) => a.ok);

  return (
    <div className="skeleton">
      {head}
      <div className="split">
        <div>
          <div className="g gauge" style={{ marginBottom: 16 }}>
            <div className="ringwrap">
              <svg width="210" height="210" viewBox="0 0 210 210">
                <defs>
                  <linearGradient id="gr" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor={stops[0]} />
                    <stop offset="100%" stopColor={stops[1]} />
                  </linearGradient>
                </defs>
                <circle cx="105" cy="105" r="92" fill="none" stroke="rgba(255,255,255,.08)" strokeWidth="13" />
                <circle
                  cx="105" cy="105" r="92" fill="none" stroke="url(#gr)" strokeWidth="13"
                  strokeLinecap="round"
                  strokeDasharray={`${RING} ${RING}`}
                  strokeDashoffset={RING * (1 - r.pct / 100)}
                  style={{ transition: 'stroke-dashoffset .7s cubic-bezier(.2,.8,.3,1)' }}
                />
              </svg>
              <div className="val">
                <div className={`n ${r.band}`}>{r.pct}%</div>
                <div className="c">cancel risk</div>
              </div>
            </div>
            <div className={`band ${r.band}`}>{BAND_LABEL[r.band]}</div>
            <div className="say">{BAND_SAY[r.band]}</div>
          </div>

          <div className="g panel">
            <h3>What&apos;s driving it</h3>
            {r.parts.map((p) => (
              <div className="fac" key={p.id}>
                <div className="fh"><span className="fn">{p.name}</span><span className="fv">+{p.pts}</span></div>
                <div className="track">
                  <div className={`fill ${bandOf(p.v)}`} style={{ width: `${(p.v * 100).toFixed(0)}%` }} />
                </div>
                <div className="note">{p.note}</div>
              </div>
            ))}
          </div>
        </div>

        <div>
          <div className="g panel" style={{ marginBottom: 16 }}>
            <h3>Your booking</h3>
            <div className="kv"><span className="k">Terminal</span><span className="v">{f.terminal}</span></div>
            <div className="kv"><span className="k">Seat</span><span className="v">{f.booking?.seat}</span></div>
            <div className="kv"><span className="k">Reference</span><span className="v">{f.booking?.pnr}</span></div>
            <div className="kv">
              <span className="k">You&apos;ve flown this route</span>
              <span className="v">{rec.flown}× · {rec.cancelled} cancelled</span>
            </div>
          </div>

          <div className="g panel">
            <h3>If this one goes</h3>
            <p style={{ margin: '0 0 14px', color: 'var(--mist)', fontSize: 13.5, lineHeight: 1.6 }}>
              We&apos;re already holding {usableAlts.length} alternatives that fit your policy and protect
              your onward connection.
            </p>
            {usableAlts.map((a) => (
              <div className="kv" key={a.id}>
                <span className="k">{a.code} · {a.dep}</span>
                <span className={`v ${a.fare ? '' : 'ok'}`}>{a.fare ? money(a.fare) : 'no cost to you'}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
