'use client';

import Link from 'next/link';
import { use, useEffect } from 'react';
import { notFound } from 'next/navigation';
import { useWorld } from '@/components/WorldProvider';
import RouteLine from '@/components/Route';
import { BAND_LABEL, BAND_SAY, BAND_TONE } from '@/lib/thresholds';
import { KIND_LABEL, kindSay } from '@/lib/disruptionKind';
import { routeRecord, OUTCOME } from '@/lib/data';
import { formatMoney } from '@/lib/airports';

const RING = 2 * Math.PI * 92;

export default function FlightPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { world, disrupted, live, refreshForecast, refreshFlightStatus, explainRisk } = useWorld();

  // On-demand only: fires once per flight id per session (dedup guard lives in
  // WorldProvider), never on a timer. This is the only place these fire.
  useEffect(() => {
    if (!world) return;
    const f = world.upcoming.find((x) => x.id === id);
    if (!f?.watched || !f.bookedDepartureAt) return;

    const minutesToDeparture = Math.max(0, Math.round((f.bookedDepartureAt - world.now.getTime()) / 60_000));
    refreshForecast(id, {
      flightIata: f.code.replace(/\s+/g, ''),
      from: f.from,
      to: f.to,
      date: new Date(f.bookedDepartureAt).toISOString().slice(0, 10),
      minutesToDeparture,
      hasHardConstraint: Boolean(f.hasHardConstraint),
    });
    refreshFlightStatus(id, f.code.replace(/\s+/g, ''), f.bookedDepartureAt, f.connectionSlackMinutes ?? null);
  }, [world, id]);

  const forecastStatus = live.forecast[id]?.status;
  useEffect(() => {
    if (!world) return;
    const f = world.upcoming.find((x) => x.id === id);
    if (!f?.watched) return;
    if (forecastStatus !== 'ok') return;
    const fc = live.forecast[id]?.data;
    if (!fc) return;
    explainRisk(id, {
      kind: 'risk',
      flightCode: f.code,
      from: f.from,
      to: f.to,
      pct: fc.pct,
      topFactor: 'the airline’s own disruption signals',
    });
  }, [world, id, forecastStatus]);

  if (!world) return <div className="page-h"><h1>Loading your flight</h1></div>;

  const f = world.upcoming.find((x) => x.id === id) ?? world.past.find((x) => x.id === id);
  if (!f) notFound();

  const isPast = !('watched' in f) || !f.watched;
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

  const fc = live.forecast[id];
  const forecast = fc?.status === 'ok' ? fc.data : undefined;
  const pending = !forecast;

  const tone = forecast ? BAND_TONE[forecast.band] : 'low';
  const stops =
    tone === 'high' ? ['#ff9aa9', 'var(--risk)']
      : tone === 'mid' ? ['#ffd98a', 'var(--warn)']
        : ['#7cf0c0', 'var(--safe)'];

  const liveExplain = live.explain[`risk:${id}`];
  const say =
    liveExplain?.status === 'ok' && liveExplain.data
      ? liveExplain.data
      : forecast
        ? BAND_SAY[forecast.band]
        : 'Checking this flight against the disruption forecast.';

  const status = live.flightStatus[id];
  const classification = status?.status === 'ok' ? status.data?.classification : null;

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
                  strokeDashoffset={RING * (1 - (forecast?.pct ?? 0) / 100)}
                  style={{ transition: 'stroke-dashoffset .7s cubic-bezier(.2,.8,.3,1)' }}
                />
              </svg>
              <div className="val">
                <div className={`n ${tone}`}>{pending ? '—' : `${forecast!.pct}%`}</div>
                <div className="c">cancel risk</div>
              </div>
            </div>
            {forecast && <div className={`band ${tone}`}>{BAND_LABEL[forecast.band]}</div>}
            <div className="say">{say}</div>
          </div>

          {forecast && (
            <div className="g panel" style={{ marginBottom: 16 }}>
              <h3>Where this number comes from</h3>
              <div className="kv">
                <span className="k">Forecast source</span>
                <span className={`v ${forecast.source === 'lumo' ? 'ok' : ''}`}>
                  {forecast.source === 'lumo' ? 'Lumo — live' : 'Lumo — mocked, no commercial key yet'}
                </span>
              </div>
              <div className="kv">
                <span className="k">Forecast confidence</span>
                <span className="v">{Math.round(forecast.confidence * 100)}%</span>
              </div>
              {forecast.connectionRisk !== null && (
                <div className="kv">
                  <span className="k">Risk to your onward leg</span>
                  <span className="v">{Math.round(forecast.connectionRisk * 100)}%</span>
                </div>
              )}
              <p style={{ margin: '12px 0 0', color: 'var(--mist)', fontSize: 12.5, lineHeight: 1.6 }}>
                We buy this forecast rather than building one. Until it has been back-tested against
                what actually happened, it is advisory — it decides when we start preparing, never
                whether we spend your money.
              </p>
            </div>
          )}

          {forecast && (
            <div className="g panel">
              <h3>What it takes to act on this flight</h3>
              <p style={{ margin: '0 0 14px', color: 'var(--mist)', fontSize: 13.5, lineHeight: 1.6 }}>
                These thresholds are not fixed. They move with how many seats are left on this route,
                how close departure is, and whether a late arrival breaks something that matters —
                because the cost of waiting is not the same on every flight.
              </p>
              <div className="kv">
                <span className="k">Start preparing at</span>
                <span className="v">{forecast.thresholds.prepare}%</span>
              </div>
              <div className="kv">
                <span className="k">Consider holding a seat at</span>
                <span className="v">{forecast.thresholds.holdGate}%</span>
              </div>
              <div className="kv">
                <span className="k">Come and ask you at</span>
                <span className="v">{forecast.thresholds.preAuthorise}%</span>
              </div>
              <div className="kv">
                <span className="k">Seats we can see on this route</span>
                <span className="v">{forecast.thresholds.inputs.seatsAvailable}</span>
              </div>
            </div>
          )}
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
            {classification && classification.kind !== 'none' && (
              <>
                <div className="kv">
                  <span className="k">Live status</span>
                  <span className="v warn">{KIND_LABEL[classification.kind]}</span>
                </div>
                <p style={{ margin: '10px 0 0', color: 'var(--mist)', fontSize: 12.5, lineHeight: 1.6 }}>
                  {kindSay(classification)}
                </p>
              </>
            )}
            {status?.status === 'ok' && !status.data?.match && (
              <p style={{ margin: '10px 0 0', color: 'var(--mist)', fontSize: 12 }}>
                Live status check: no live match today — expected for this demo flight.
              </p>
            )}
          </div>

          <div className="g panel">
            <h3>If this one goes</h3>
            <p style={{ margin: '0 0 14px', color: 'var(--mist)', fontSize: 13.5, lineHeight: 1.6 }}>
              We&apos;re already tracking {world.alts.filter((a) => a.ok).length} alternatives that fit your
              policy and protect your onward connection.
            </p>
            {world.alts.filter((a) => a.ok).map((a) => (
              <div className="kv" key={a.id}>
                <span className="k">{a.code} · {a.dep}</span>
                <span className={`v ${a.fare ? '' : 'ok'}`}>
                  {a.fare ? formatMoney(a.fare, a.currency) : 'no cost to you'}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
