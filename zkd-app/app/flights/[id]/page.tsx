'use client';

import Link from 'next/link';
import { use, useEffect, useState } from 'react';
import { notFound } from 'next/navigation';
import { useWorld } from '@/components/WorldProvider';
import RouteLine from '@/components/Route';
import { usePoll } from '@/lib/usePoll';
import { BAND_LABEL, BAND_SAY } from '@/lib/thresholds';
import { OUTCOME } from '@/lib/outcome';
import { hhmm, mins, dayLabel, money } from '@/lib/time';
import type { FlightDetail, FlightForecast, ReverifyResult } from '@/lib/apiTypes';
import type { PastFlight } from '@/server/domain/types';
import ForecastAudit from '@/components/ForecastAudit';
import { FlightDetailSkeleton, RiskBodySkeleton } from '@/components/PageSkeletons';

const RING = 2 * Math.PI * 92;

function routeRecord(past: PastFlight[], from: string, to: string) {
  const rows = past.filter((p) => p.from === from && p.to === to);
  return { flown: rows.length, cancelled: rows.filter((p) => p.outcome === 'cancelled').length };
}

/**
 * Wraps whatever the page renders in the Amex skin's page/container shell.
 *
 * Done once here rather than at each of the five return points inside
 * FlightBody (past flight, two loading states, not-found, and the live view) —
 * one of them would inevitably get missed, and a return without the wrapper
 * renders a dark-theme page on a light background.
 */
export default function FlightPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <div className="amex-page">
      <div className="amex-container">
        <FlightBody params={params} />
      </div>
    </div>
  );
}

function FlightBody({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { schedule } = useWorld();

  const upcoming = schedule?.upcoming.find((x) => x.id === id);
  const past = schedule?.past.find((x) => x.id === id);

  // Gated on `past`, NOT on `upcoming` — the two are not equivalent before the
  // schedule arrives, and the difference is a whole round trip.
  //
  // `upcoming` is derived from `schedule`, so gating on it meant this request
  // could not start until the schedule had already landed — and WorldProvider
  // fetches /api/auth/me before that. Three serial round trips before any real
  // content, on a page whose own API answers in ~50ms.
  //
  // `past` is undefined while the schedule is still loading, so this fires
  // immediately and races the schedule instead of queueing behind it. Once the
  // schedule does arrive, a past flight flips this to null and polling stops —
  // which is the only thing the original gate was actually for (past flights
  // are a frozen record with no live candidates or signals). The route is
  // session-guarded server-side, so starting early cannot leak anything.
  const { data: detail } = usePoll<FlightDetail>(past ? null : `/api/flights/${id}`, 5000);

  // Reverify lives here (not inside ForecastAudit) because its trigger sits
  // next to the headline score, not in the audit panel below. liveForecast
  // is an optimistic override so the number updates the instant reverify
  // returns, instead of waiting up to 5s for the next poll tick; once the
  // poll's own forecast catches up (same or newer asOf), the override clears
  // itself so polling stays the single source of truth going forward.
  const [reverifyBusy, setReverifyBusy] = useState(false);
  const [reverifyError, setReverifyError] = useState<string | null>(null);
  const [liveForecast, setLiveForecast] = useState<FlightForecast | null>(null);

  useEffect(() => {
    if (liveForecast && detail?.forecast && detail.forecast.asOf >= liveForecast.asOf) {
      setLiveForecast(null);
    }
  }, [detail?.forecast, liveForecast]);

  async function onReverify() {
    setReverifyBusy(true);
    setReverifyError(null);
    try {
      const res = await fetch(`/api/flights/${id}/reverify`, { method: 'POST' });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setReverifyError(body.error ?? `reverify failed (${res.status})`);
        return;
      }
      const json = (await res.json()) as ReverifyResult;
      setLiveForecast(json.current);
    } catch {
      setReverifyError('Could not reach the model to reverify.');
    } finally {
      setReverifyBusy(false);
    }
  }

  if (!schedule) return <FlightDetailSkeleton />;
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

  // The head is already real here — only the risk body is still in flight, so
  // only that part is replaced, and only that part is hidden from assistive
  // tech. Nothing above the split moves when `detail` lands.
  if (!detail) {
    return (
      <div className="skeleton" aria-busy="true">
        {head}
        <span className="sk-sr" role="status">Loading the risk detail for this flight</span>
        <div aria-hidden="true"><RiskBodySkeleton /></div>
      </div>
    );
  }

  const fc = liveForecast ?? detail.forecast;
  const tone = fc?.tone ?? 'low';
  const headline = fc ? Math.round(fc.riskScore ?? fc.pct) : null;
  const stops =
    tone === 'high' ? ['#ff9aa9', 'var(--risk)']
      : tone === 'mid' ? ['#ffd98a', 'var(--warn)']
        : ['#7cf0c0', 'var(--safe)'];
  const usableAlts = detail.candidates.alts.filter((a) => a.ok);

  // What comes BACK if this flight dies — the other half of every price below.
  // Quoting a replacement fare on its own overstates the cost by the whole
  // original ticket, which is the number the member is actually owed.
  // `known: false` means we have no record of what they paid; that renders as
  // "not known yet" and never as zero, because a guessed refund becomes a wrong
  // difference and the difference is what they decide on.
  const refund = detail.refund;
  const refundKnown = !!refund?.known;
  const refundTotal = refundKnown ? refund!.total : 0;

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
                  strokeDashoffset={RING * (1 - (headline ?? 0) / 100)}
                  style={{ transition: 'stroke-dashoffset .7s cubic-bezier(.2,.8,.3,1)' }}
                />
              </svg>
              <div className="val">
                <div className={`n ${tone}`}>{headline ?? '—'}</div>
                <div className="c">
                  risk score
                  {fc && (
                    <button
                      type="button"
                      onClick={onReverify}
                      disabled={reverifyBusy}
                      title="Reverify — force a fresh real score right now"
                      aria-label="Reverify this prediction"
                      style={{
                        marginLeft: 6, border: 0, background: 'none', color: 'inherit', cursor: 'pointer',
                        fontSize: 12, opacity: reverifyBusy ? 0.5 : 0.8, verticalAlign: -1,
                        display: 'inline-block', animation: reverifyBusy ? 'spin 0.8s linear infinite' : 'none',
                      }}
                    >
                      ↻
                    </button>
                  )}
                </div>
                {reverifyError && (
                  <div style={{ fontSize: 10.5, color: 'var(--risk)', marginTop: 4 }}>{reverifyError}</div>
                )}
              </div>
            </div>
            {fc && <div className={`band ${tone}`}>{BAND_LABEL[fc.band]}</div>}
            <div className="say">
              {fc ? BAND_SAY[fc.band] : 'Checking this flight against the disruption forecast.'}
            </div>
          </div>

          {fc && (
            <div className="g panel" style={{ marginBottom: 16 }}>
              <h3>Where this number comes from</h3>
              <div className="kv">
                <span className="k">Forecast source</span>
                <span className="v ok">In-house model — live</span>
              </div>
              <div className="kv">
                <span className="k">Model version</span>
                <span className="v">{fc.modelVersion}</span>
              </div>
              <div className="kv">
                <span className="k">Forecast confidence</span>
                <span className="v">{Math.round(fc.confidence * 100)}%</span>
              </div>
              {fc.connectionRisk !== null && (
                <div className="kv">
                  <span className="k">Risk to your onward leg</span>
                  <span className="v">{Math.round(fc.connectionRisk * 100)}%</span>
                </div>
              )}
              <div className="kv">
                <span className="k">Real calibrated probability</span>
                <span className="v">{fc.pct}%</span>
              </div>
              <p className="why">
                This is our own model, trained on real historical flight data — not a vendor call. It
                is still advisory in the same sense it always was: it decides when we start preparing,
                never whether we spend your money. See the audit panel below for exactly why it landed
                on this number.
                {fc.riskScore !== undefined && (
                  <>
                    {' '}The score in the ring above is a 0–100 ranking — where this flight sits against
                    every flight we've scored — not a probability. The {fc.pct}% here is the real,
                    calibrated chance of cancellation: genuine cancellations are rare, so that number
                    stays small even for a flight worth watching.
                  </>
                )}
              </p>
            </div>
          )}

          {fc && (
            <div className="g panel">
              <h3>What it takes to act on this flight</h3>
              <p style={{ margin: '0 0 14px', color: 'var(--mist)', fontSize: 13.5, lineHeight: 1.6 }}>
                These thresholds are not fixed. They move with how many seats are left on this route,
                how close departure is, and whether a late arrival breaks something that matters —
                because the cost of waiting is not the same on every flight.
              </p>
              <div className="kv"><span className="k">Start preparing at</span><span className="v">{fc.thresholds.prepare}%</span></div>
              <div className="kv"><span className="k">Keep a backup plan current at</span><span className="v">{fc.thresholds.holdGate}%</span></div>
              <div className="kv"><span className="k">Come and ask you at</span><span className="v">{fc.thresholds.preAuthorise}%</span></div>
              <div className="kv"><span className="k">Seats we can see on this route</span><span className="v">{fc.thresholds.inputs.seatsAvailable}</span></div>
            </div>
          )}
        </div>

        <div>
          <div className="g panel" style={{ marginBottom: 16 }}>
            <h3>Your booking</h3>
            <div className="kv"><span className="k">Terminal</span><span className="v">{f.terminal}</span></div>
            {f.booking && f.booking.partySize > 1 ? (
              <>
                <div className="kv"><span className="k">Travellers</span><span className="v">{f.booking.partySize}</span></div>
                <div className="kv">
                  <span className="k">Seats</span>
                  <span className="v">{f.booking.travellers.map((t) => t.seat).join(', ')}</span>
                </div>
              </>
            ) : (
              <div className="kv"><span className="k">Seat</span><span className="v">{f.booking?.seat}</span></div>
            )}
            <div className="kv"><span className="k">Reference</span><span className="v">{f.booking?.pnr}</span></div>
            <div className="kv">
              <span className="k">You&apos;ve flown this route</span>
              <span className="v">{rec.flown}× · {rec.cancelled} cancelled</span>
            </div>
          </div>

          <div className="g panel">
            <h3>If this one goes</h3>
            <p style={{ margin: '0 0 14px', color: 'var(--mist)', fontSize: 13.5, lineHeight: 1.6 }}>
              {/*
                NOT "holding". Nothing is reserved and nothing can be: a
                passenger cannot hold two tickets, and a carrier's auditors
                cancel duplicates — sometimes cancelling the original. That is
                why speculative holds were removed from the design entirely
                (memory.md, 2026-08-17); the refresh loop keeps these options
                current instead. server/notify/templates.ts has a test asserting
                its copy never claims a hold, and this line was quietly saying
                the opposite on the screen a member actually reads.
              */}
              {usableAlts.length === 0 ? (
                /*
                  Alternative search is gated on the risk band — a low-risk
                  flight deliberately never spends a supplier call. Saying "we've
                  lined up 0 alternatives" reads as a failure when it is the
                  system working correctly, so say what is actually true: we are
                  not searching yet, and here is what would make us.
                */
                <>
                  We haven&apos;t needed to search yet. This flight isn&apos;t risky enough to
                  spend a supplier call on — if that changes, we start lining up alternatives
                  automatically, before anything is cancelled.
                </>
              ) : (
                <>
                  We&apos;ve lined up {usableAlts.length} alternative{usableAlts.length === 1 ? '' : 's'} that
                  {f.booking && f.booking.partySize > 1 ? ` seat all ${f.booking.partySize} of you and` : ''} fit your
                  policy and protect your onward connection — re-checked continuously, so they&apos;re
                  still valid the moment we need them.
                  {refundKnown && refundTotal > 0 && (
                    <> Prices below are what you&apos;d pay after the {money(refundTotal)} refunded
                    on your original ticket.</>
                  )}
                </>
              )}
            </p>
            {/* One line per option, exactly as before — the list is the thing
                being scanned and a second line under every price turned it into
                a wall. The refund belongs in the sentence above rather than in
                a row of its own: it is a property of the ticket being
                cancelled, not of the alternative chosen. */}
            {usableAlts.map((a) => (
              <Link
                href={`/prepare/${f.id}`}
                key={a.id}
                className="kv"
                style={{ textDecoration: 'none', color: 'inherit' }}
              >
                <span className="k">{a.code} · {a.dep}</span>
                <span className={`v ${refundKnown && a.partyFare - refundTotal <= 0 ? 'ok' : ''}`}>
                  {/* What they actually pay: the fare, less what the cancelled
                      ticket returns. Shown negative when the replacement is
                      cheaper than the refund — a real outcome, and the one
                      members are most pleased to hear about. */}
                  {!refundKnown
                    ? money(a.partyFare)
                    : a.partyFare - refundTotal > 0
                      ? money(a.partyFare - refundTotal)
                      : a.partyFare - refundTotal < 0
                        ? `${money(refundTotal - a.partyFare)} back`
                        : 'nothing to pay'}
                </span>
              </Link>
            ))}
          </div>
        </div>
      </div>

      {fc && (
        <div style={{ marginTop: 16 }}>
          <ForecastAudit forecast={fc} history={detail.forecastHistory} depISO={f.depISO} />
        </div>
      )}
    </div>
  );
}
