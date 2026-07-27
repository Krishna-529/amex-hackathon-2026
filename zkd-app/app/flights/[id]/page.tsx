'use client';

import Link from 'next/link';
import { use } from 'react';
import { notFound } from 'next/navigation';
import { useWorld } from '@/components/WorldProvider';
import RouteLine from '@/components/Route';
import { risk, BAND_LABEL, BAND_SAY, bandOf } from '@/lib/risk';
import { routeRecord, OUTCOME } from '@/lib/data';
import { money } from '@/lib/time';

const RING = 2 * Math.PI * 92;

export default function FlightPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { world, disrupted } = useWorld();

  if (!world) return <div className="page-h"><h1>Loading your flight</h1></div>;

  const f = world.upcoming.find((x) => x.id === id) ?? world.past.find((x) => x.id === id);
  if (!f) notFound();

  const isPast = !('signals' in f) || !f.signals;
  const rec = routeRecord(world.past, f.from, f.to);

  const head = (
    <>
      <Link href="/flights" className="back">← All flights</Link>
      <div className="page-h" style={{ padding: '0 0 30px' }}>
        <h1>{f.code} · {f.from} → {f.to}</h1>
        <p>{f.date}{f.aircraft ? ` · ${f.aircraft}` : ''} · {f.dep} – {f.arr}</p>
      </div>
      <div className="g panel" style={{ marginBottom: 16 }}><RouteLine f={f} /></div>
    </>
  );

  if (isPast) {
    const pf = f as import('@/lib/data').PastFlight;
    const o = OUTCOME[pf.outcome];
    const tone = pf.outcome === 'ontime' ? 'ok' : pf.outcome === 'delayed' ? 'warn' : 'bad';
    return (
      <div className="skeleton">
        {head}
        <div className="split">
          <div className="g panel">
            <h3>What happened</h3>
            <div className="kv"><span className="k">Outcome</span><span className={`v ${tone}`}>{o.label}</span></div>
            <div className="kv"><span className="k">Detail</span><span className="v">{pf.detail}</span></div>
            <div className="kv">
              <span className="k">You&apos;ve flown {f.from}→{f.to}</span>
              <span className="v">{rec.flown}× · {rec.cancelled} cancelled</span>
            </div>
          </div>
          {pf.recovered ? (
            <div className="g plan"><h3>What we did</h3><p>{pf.recovered}</p></div>
          ) : (
            <div className="g panel">
              <h3>Notes</h3>
              <p style={{ margin: 0, color: 'var(--mist)', fontSize: 13.5 }}>
                Nothing needed doing on this one.
              </p>
            </div>
          )}
        </div>
      </div>
    );
  }

  // a cancelled upcoming flight belongs on the recovery route, not here
  if (f.id === 'u1' && disrupted) {
    return (
      <div className="skeleton">
        {head}
        <div className="g panel">
          <h3>This flight was cancelled</h3>
          <p style={{ margin: '0 0 16px', color: 'var(--mist)', fontSize: 13.5 }}>
            We&apos;ve already rebuilt your trip around it.
          </p>
          <Link href="/recovery/u1" className="cta" style={{ display: 'flex' }}>View the recovery →</Link>
        </div>
      </div>
    );
  }

  const r = risk(f.signals!);
  const stops =
    r.band === 'high' ? ['#ff9aa9', 'var(--risk)']
      : r.band === 'mid' ? ['#ffd98a', 'var(--warn)']
        : ['#7cf0c0', 'var(--safe)'];

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
            <div className="kv"><span className="k">Seat</span><span className="v">{f.seat}</span></div>
            <div className="kv"><span className="k">Reference</span><span className="v">{f.pnr}</span></div>
            <div className="kv">
              <span className="k">You&apos;ve flown this route</span>
              <span className="v">{rec.flown}× · {rec.cancelled} cancelled</span>
            </div>
          </div>

          <div className="g panel">
            <h3>If this one goes</h3>
            <p style={{ margin: '0 0 14px', color: 'var(--mist)', fontSize: 13.5, lineHeight: 1.6 }}>
              We&apos;re already holding {world.alts.filter((a) => a.ok).length} alternatives that fit your
              policy and protect your onward connection.
            </p>
            {world.alts.filter((a) => a.ok).map((a) => (
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
