'use client';

import Link from 'next/link';
import { use, useEffect, useRef, useState } from 'react';
import { notFound } from 'next/navigation';
import { useWorld } from '@/components/WorldProvider';
import RouteLine from '@/components/Route';
import { usePoll } from '@/lib/usePoll';
import { BAND_LABEL, BAND_SAY, type Band } from '@/lib/thresholds';
import { OUTCOME } from '@/lib/outcome';
import { hhmm, mins, dayLabel, money } from '@/lib/time';
import { roomsFor, vehiclesFor } from '@/lib/partyCost';
import type { FlightDetail, FlightForecast, ReverifyResult, PreAuthResponse } from '@/lib/apiTypes';
import type { PastFlight } from '@/server/domain/types';
import ForecastAudit from '@/components/ForecastAudit';
import { FlightDetailSkeleton, RiskBodySkeleton } from '@/components/PageSkeletons';
import { AnimatedScore } from '@/components/AnimatedScore';

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

/**
 * Above this band, the page stops being a status read-out and starts asking the
 * member to decide.
 *
 * `prepare` rather than a hand-picked percentage, because the system already
 * has an opinion about when a flight is worth interrupting someone over:
 * server/notify/bandCrossing.ts uses exactly this band as the point a member's
 * phone is allowed to buzz, and it is the same band that gates the alternative
 * pre-fetch. Using it here keeps one answer to "is this serious yet" instead of
 * three — a screen that showed a plan the notifier did not think worth sending,
 * or hid one it did, would be incoherent.
 */
const PLAN_AT: Band = 'prepare';
const BAND_ORDER: Band[] = ['watch', 'prepare', 'hold-gate', 'pre-authorise'];
const atOrAbove = (b: Band | undefined, floor: Band) =>
  b !== undefined && BAND_ORDER.indexOf(b) >= BAND_ORDER.indexOf(floor);

/** One bubble in the running conversation. */
type ConversationTurn = { role: 'member' | 'assistant'; text: string; at: number; isClarification?: boolean };

/** What every /api/flights/[id]/intent verb (GET, POST, DELETE) hands back. The
 *  route applies nothing — this is a preview the member confirms or discards. */
type ConversationView = {
  understood: boolean;
  message?: string;
  turns: ConversationTurn[];
  diff: { changes: string[]; clamped: string[]; unsupported: { asked: string; why: string }[] } | null;
  clarification: string | null;
  removed?: { id: string; code: string; rule: string }[];
  options?: { id: string; code: string; dep: string; arr: string; partyFare: number; ok: boolean; why: string }[];
};

function FlightBody({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { schedule } = useWorld();

  // ── Everything below used to be a second page, /prepare/[id] ──────────────
  //
  // Splitting them meant a member read their flight's risk on one screen and
  // acted on it from another, and the two disagreed visually: /flights/[id] is
  // on the Amex light skin (lib/amexRoutes.ts) and /prepare never was, so
  // clicking through went from a white Amex page into dark glass. Folding it in
  // removes the jump and the duplication in one move — the risk score and the
  // response to it now sit on one page, which is also how a member thinks about
  // it.
  const [altId, setAltId] = useState<string | null>(null);
  const [hotelId, setHotelId] = useState<string | null>(null);
  const [cabId, setCabId] = useState<string | null>(null);

  // Pre-authorise ("Yes — do this if it cancels") request state. Without this the
  // button POSTed and ignored the result, so a rejected request looked identical
  // to a successful one — the member had no way to tell their instruction never
  // landed.
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authDone, setAuthDone] = useState(false);

  // Free-text intent. This is a PREVIEW: nothing it returns is applied to the
  // member's profile or to any recovery until they confirm, which is what makes
  // it safe to let a language model near the input at all.
  const [text, setText] = useState('');
  const [thinking, setThinking] = useState(false);
  const [conv, setConv] = useState<ConversationView | null>(null);
  // Restore the conversation once, when the plan panel first becomes available,
  // so a refresh mid-chat brings back the thread AND the ranking it produced.
  const convLoaded = useRef(false);

  // The member as a detection source. Behind our own confirm modal (not the
  // browser's), because pressing it checks the flight against our airline data:
  // if it really is cancelled we mark it and start rebooking; if not we tell them
  // so and give them a helpline (server/engine/memberReports.ts).
  const [reportOpen, setReportOpen] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [reportResult, setReportResult] = useState<
    { status: 'cancelled' | 'not-cancelled'; message: string; helpline?: string | null } | null
  >(null);

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
  // The session on this request IS the passenger, so no id travels in the URL.
  const { data: preAuth } = usePoll<PreAuthResponse>(past ? null : `/api/flights/${id}/preauth`, 8000);

  // Apply a view the server returned: store it, and follow the new top option
  // whenever the ranking changed under us.
  const applyView = (v: ConversationView) => {
    setConv(v);
    if (v.options?.length) setAltId((v.options.find((o) => o.ok) ?? v.options[0]).id);
  };

  const send = () => {
    if (!text.trim() || thinking) return;
    const message = text;
    setThinking(true);
    setText('');
    fetch(`/api/flights/${id}/intent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: message }),
    })
      .then((r) => r.json())
      .then((v: ConversationView) => {
        // A message we could not read leaves the thread as it was — put the
        // member's text back so they can edit rather than retype it.
        if (!v.understood) setText(message);
        applyView(v);
      })
      .catch(() => setConv((c) => (c ? { ...c, understood: false, message: 'We could not reach that service. Nothing changed.' } : c)))
      .finally(() => setThinking(false));
  };

  const undo = () => {
    if (thinking) return;
    setThinking(true);
    fetch(`/api/flights/${id}/intent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ undo: true }),
    })
      .then((r) => r.json())
      .then(applyView)
      .catch(() => {})
      .finally(() => setThinking(false));
  };

  const reset = () => {
    if (thinking) return;
    setThinking(true);
    fetch(`/api/flights/${id}/intent`, { method: 'DELETE' })
      .then((r) => r.json())
      .then(applyView)
      .catch(() => {})
      .finally(() => setThinking(false));
  };

  // Restore a prior conversation once, for a live flight — so a refresh mid-chat
  // brings the thread and its ranking back. A past flight is a frozen record
  // with nothing to resume.
  useEffect(() => {
    if (convLoaded.current || past) return;
    convLoaded.current = true;
    fetch(`/api/flights/${id}/intent`)
      .then((r) => (r.ok ? r.json() : null))
      .then((v: ConversationView | null) => { if (v?.turns?.length) setConv(v); })
      .catch(() => {});
  }, [id, past]);

  const openReport = () => { setReportResult(null); setReportOpen(true); };
  const closeReport = () => { if (!reporting) setReportOpen(false); };

  const runReportCheck = () => {
    if (reporting) return;
    setReporting(true);
    fetch(`/api/flights/${id}/report-cancellation`, { method: 'POST' })
      .then((r) => r.json())
      .then((r) =>
        setReportResult({
          status: r.status === 'cancelled' || r.confirmed ? 'cancelled' : 'not-cancelled',
          message: r.message ?? r.error ?? 'Checked.',
          helpline: r.helpline ?? null,
        }),
      )
      .catch(() =>
        setReportResult({
          status: 'not-cancelled',
          message: 'We could not reach our systems just now — please try again in a moment.',
          helpline: null,
        }),
      )
      .finally(() => setReporting(false));
  };

  const authorise = async () => {
    // Send the RESOLVED selection, not the raw pickers. `hotelId`/`cabId` state
    // has no UI on this screen and is always null; `alt`/`hotel`/`cab` (below)
    // already resolve to the chosen row or a sensible default. Only the
    // alternative is required — hotel/cab ride along when they exist.
    if (authBusy || !alt?.id) return;
    setAuthBusy(true);
    setAuthError(null);
    try {
      const res = await fetch(`/api/flights/${id}/preauth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ altId: alt.id, hotelId: hotel?.id ?? null, cabId: cab?.id ?? null }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setAuthError(body.error ?? `Could not save that instruction (${res.status}).`);
        return;
      }
      setAuthDone(true);
    } catch {
      setAuthError('We could not reach the service just now — please try again.');
    } finally {
      setAuthBusy(false);
    }
  };

  // Changing the chosen alternative invalidates a previous confirmation — clear
  // the "saved" tick and any error so the button reflects the current choice.
  useEffect(() => { setAuthDone(false); setAuthError(null); }, [altId]);

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

  // ── is this serious enough to ask them to decide? ─────────────────────────
  const planning = atOrAbove(fc?.band, PLAN_AT);

  // The intent preview re-orders the list; without one we show what the scorer
  // already decided. Either way the member is looking at a real ranking. Capped
  // to the ranker's top 5 — a member choosing a replacement does not want to
  // scroll a whole inventory, and anything past the fifth-best is noise.
  const orderedAlts = (conv?.options?.length
    ? (conv.options
        .map((o) => usableAlts.find((a) => a.id === o.id))
        .filter(Boolean) as typeof usableAlts)
    : usableAlts
  ).slice(0, 5);

  const alt = orderedAlts.find((a) => a.id === altId) ?? orderedAlts[0];
  const hotel = detail.candidates.hotels.find((h) => h.id === hotelId)
    ?? detail.candidates.hotels.find((h) => h.ok) ?? detail.candidates.hotels[0];
  const cab = detail.candidates.cabs.find((c) => c.id === cabId)
    ?? detail.candidates.cabs.find((c) => c.ok) ?? detail.candidates.cabs[0];

  const partySize = detail.booking?.partySize ?? 1;
  const rooms = roomsFor(partySize);
  const vehicles = cab ? vehiclesFor(partySize, cab.seats) : 0;
  const hotelCost = hotel ? (hotel.extra || hotel.rate) * rooms : 0;
  const cabCost = cab ? cab.extra * vehicles : 0;
  const owed = (alt?.partyFare ?? 0) + hotelCost + cabCost;
  // The number the member actually decides on. The airline returns money, not a
  // seat — so what this costs is the replacement minus what comes back.
  const delta = owed - refundTotal;

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
                {/* The track carries a class rather than a literal stroke: this page renders
                    on the Amex LIGHT skin, where a white-alpha ring is invisible.
                    globals.css already styles `.amex-page .gauge .track` — the class was
                    simply never applied, so the ring has been missing on the skinned
                    page all along. */}
                <circle className="track" cx="105" cy="105" r="92" fill="none" strokeWidth="13" />
                <circle
                  cx="105" cy="105" r="92" fill="none" stroke="url(#gr)" strokeWidth="13"
                  strokeLinecap="round"
                  strokeDasharray={`${RING} ${RING}`}
                  strokeDashoffset={RING * (1 - (headline ?? 0) / 100)}
                  style={{ transition: 'stroke-dashoffset .7s cubic-bezier(.2,.8,.3,1)' }}
                />
              </svg>
              <div className="val">
                <div className={`n ${tone}`}><AnimatedScore value={headline} /></div>
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
                  {' '}
                  {refundKnown ? (
                    <>Original ticket refund: {money(refundTotal, refund?.currency)}.</>
                  ) : (
                    <>Original ticket refund: not known yet.</>
                  )}
                </>
              )}
            </p>
            {/* One line per option. Below the plan band this is a read-only
                preview — the member is being reassured, not asked. Above it the
                rows become selectable and the plan below them appears. */}
            {orderedAlts.map((a) => {
              const rowDelta = a.partyFare + hotelCost + cabCost - refundTotal;
              const picked = planning && a.id === alt?.id;
              return (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => planning && setAltId(a.id)}
                  disabled={!planning}
                  className="kv"
                  style={{
                    width: '100%', font: 'inherit', textAlign: 'left', border: 0,
                    background: picked ? 'var(--amex-line2, rgba(47,127,240,.08))' : 'transparent',
                    cursor: planning ? 'pointer' : 'default',
                    borderRadius: 6, paddingLeft: 8, paddingRight: 8,
                  }}
                >
                  <span className="k">
                    {picked ? '\u2713 ' : ''}{a.code} · {a.dep}
                  </span>
                  <span className={`v ${refundKnown && rowDelta <= 0 ? 'ok' : ''}`}>
                    {!refundKnown ? (
                      <>{money(a.partyFare, a.currency)} · refund not known yet</>
                    ) : (
                      <>
                        {money(a.partyFare, a.currency)} → {rowDelta > 0 ? money(rowDelta) : rowDelta < 0 ? `${money(-rowDelta)} back` : money(0)} after refund
                      </>
                    )}
                  </span>
                </button>
              );
            })}
          </div>

          {/* ── Everything below appears only once the flight is actually at
              risk. Under that band the page stays what it has always been: a
              status read-out. ─────────────────────────────────────────────── */}
          {planning && (
            <>
              <div className="g panel intent-chat" style={{ marginTop: 16 }}>
                <div className="intent-head">
                  <h3 style={{ margin: 0 }}>Tell us what matters</h3>
                  {!!conv?.turns?.length && (
                    <div className="intent-controls">
                      <button onClick={undo} disabled={thinking} className="link-btn">Undo</button>
                      <button onClick={reset} disabled={thinking} className="link-btn">Reset</button>
                    </div>
                  )}
                </div>

                <div className="intent-thread" aria-live="polite">
                  {!conv?.turns?.length ? (
                    <p className="intent-empty">
                      In your own words — a deadline you have to hit, an airline you would rather not fly,
                      how much of your own money you will spend. Keep talking to refine it; the options
                      above re-order as you do, and you can take anything back.
                    </p>
                  ) : (
                    conv.turns.map((t, i) => (
                      <div key={`${t.at}-${i}`} className={`bubble ${t.role}${t.isClarification ? ' clarify' : ''}`}>
                        {t.role === 'assistant' && t.isClarification && <span className="bubble-tag">One thing —</span>}
                        {t.text}
                      </div>
                    ))
                  )}
                  {thinking && <div className="bubble assistant pending"><span className="dots"><i /><i /><i /></span></div>}
                </div>

                {conv && !conv.understood && conv.message && (
                  <p className="why intent-error">{conv.message}</p>
                )}

                <div className="intent-input">
                  <textarea
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
                    }}
                    maxLength={600}
                    rows={2}
                    aria-label="What matters to you about this trip"
                    placeholder={conv?.clarification ? 'Answer above, or say something else…' : "e.g. be in Delhi before 9pm, not Air India"}
                    className="intent-box"
                  />
                  <button onClick={send} disabled={thinking || !text.trim()} className="intent-send" aria-label="Send">
                    {thinking ? '…' : 'Send'}
                  </button>
                </div>

                {/* The running effect of the whole conversation, not just the last
                    message — what will happen, what we adjusted, and what your own
                    words ruled out. */}
                {(!!conv?.diff?.changes.length || !!conv?.diff?.clamped.length || !!conv?.diff?.unsupported.length || !!conv?.removed?.length) && (
                  <div className="intent-summary">
                    {!!conv?.diff?.changes.length && (
                      <><div className="lbl">What we will do</div>
                        <ul className="why">{conv.diff.changes.map((c) => <li key={c}>{c}</li>)}</ul></>
                    )}
                    {!!conv?.diff?.clamped.length && (
                      <><div className="lbl">What we adjusted</div>
                        <ul className="why">{conv.diff.clamped.map((c) => <li key={c}>{c}</li>)}</ul></>
                    )}
                    {!!conv?.diff?.unsupported.length && (
                      <><div className="lbl">What we cannot do</div>
                        <ul className="why" style={{ color: 'var(--risk)' }}>{conv.diff.unsupported.map((u) => <li key={u.asked}>{u.asked} — {u.why}</li>)}</ul></>
                    )}
                    {!!conv?.removed?.length && (
                      <><div className="lbl">Ruled out by what you told us</div>
                        <ul className="why">{conv.removed.map((r) => <li key={r.id}>{r.code} — {r.rule}</li>)}</ul></>
                    )}
                  </div>
                )}
              </div>

              <div className="g panel" style={{ marginTop: 16 }}>
                <h3>If it does cancel, here is the plan</h3>
                {partySize > 1 && (
                  <div className="kv">
                    <span className="k">Party</span>
                    <span className="v">{partySize} travellers · {rooms} room{rooms === 1 ? '' : 's'} · {vehicles} cab{vehicles === 1 ? '' : 's'}</span>
                  </div>
                )}
                {alt && (
                  <div className="kv">
                    <span className="k">Flight</span>
                    <span className="v">{alt.code} · arrives {alt.arr}</span>
                  </div>
                )}
                {hotel && (
                  <div className="kv">
                    <span className="k">Room{rooms > 1 ? 's' : ''} tonight</span>
                    <span className="v">{hotel.name} · {hotel.area}</span>
                  </div>
                )}
                {cab && (
                  <div className="kv">
                    <span className="k">Transfers</span>
                    <span className="v">{cab.kind}{vehicles > 1 ? ` × ${vehicles}` : ''}</span>
                  </div>
                )}

                <div className="kv" style={{ marginTop: 6 }}>
                  <span className="k">This plan costs</span>
                  <span className={`v ${owed ? 'warn' : 'ok'}`}>{owed ? money(owed) : 'nothing'}</span>
                </div>
                <div className="kv">
                  <span className="k">Comes back to your card</span>
                  <span className={`v ${refundKnown && refundTotal > 0 ? 'ok' : ''}`}>
                    {refundKnown ? (refundTotal > 0 ? money(refundTotal) : 'nothing') : 'not known yet'}
                  </span>
                </div>
                <div className="kv">
                  <span className="k"><b>You end up paying</b></span>
                  <span className={`v ${delta > 0 ? 'warn' : 'ok'}`}>
                    {!refundKnown ? `${money(owed)} before any refund`
                      : delta > 0 ? money(delta)
                        : delta < 0 ? `${money(-delta)} back to you`
                          : 'nothing'}
                  </span>
                </div>

                {!refundKnown && (
                  <p className="why">
                    We have no record of what you paid for this ticket, so we are not going to guess
                    what comes back. The figure above is what the replacement costs before any refund.
                  </p>
                )}

                <p className="why">
                  This is a conditional instruction, not a booking. Nothing is charged unless this
                  flight is actually cancelled, and if these exact options are gone by then we come
                  back to you rather than substituting something you never saw.
                </p>

                {preAuth ? (
                  <p className="why" style={{ color: 'var(--safe)' }}>
                    You have already told us what to do. Choosing again above and confirming will
                    replace that instruction.
                  </p>
                ) : null}

                {authError && (
                  <p className="why" style={{ color: 'var(--risk)' }}>{authError}</p>
                )}

                <button
                  className="cta"
                  onClick={authorise}
                  disabled={authBusy || !alt?.id}
                  style={{ width: '100%' }}
                >
                  {authBusy
                    ? 'Saving…'
                    : authDone
                      ? 'Saved — we act the second it cancels'
                      : 'Yes — do this if it cancels'}
                </button>
              </div>
            </>
          )}

          {/* The backup detection lane. Deliberately quiet and always available:
              a member can be standing at a cancelled gate on a flight our model
              still thinks is healthy. */}
          <div className="g panel" style={{ marginTop: 16 }}>
            <h3>Already cancelled?</h3>
            <p className="why" style={{ marginTop: 0 }}>
              If the airline has told you this flight is cancelled and we have not caught it yet,
              tell us and we will start straight away rather than wait for the feed.
            </p>
            {reportResult && !reportOpen ? (
              <p className="why" style={{ color: reportResult.status === 'cancelled' ? 'var(--safe)' : undefined }}>
                {reportResult.message}
              </p>
            ) : (
              <button onClick={openReport}>This flight was cancelled</button>
            )}
          </div>
        </div>
      </div>

      {fc && (
        <div style={{ marginTop: 16 }}>
          <ForecastAudit forecast={fc} history={detail.forecastHistory} depISO={f.depISO} />
        </div>
      )}

      {reportOpen && (
        <div className="zkd-modal-scrim" role="dialog" aria-modal="true" onClick={closeReport}>
          <div className="zkd-modal" onClick={(e) => e.stopPropagation()}>
            {!reportResult ? (
              <>
                <h3>Sorry for the inconvenience</h3>
                <p>
                  Before we do anything, let us check {detail.code} against the airline&apos;s own
                  records. If it really has been cancelled we&apos;ll mark it and start rebooking you
                  right away — and nothing is charged without telling you first.
                </p>
                <div className="zkd-modal-acts">
                  <button className="zkd-btn primary" onClick={runReportCheck} disabled={reporting}>
                    {reporting ? 'Checking…' : 'Check now'}
                  </button>
                  <button className="zkd-btn ghost" onClick={closeReport} disabled={reporting}>Not now</button>
                </div>
              </>
            ) : reportResult.status === 'cancelled' ? (
              <>
                <h3 style={{ color: 'var(--safe)' }}>We&apos;ve marked it cancelled</h3>
                <p>{reportResult.message}</p>
                <div className="zkd-modal-acts">
                  <a className="zkd-btn primary" href={`/recovery/${id}`}>See your rebooking →</a>
                  <button className="zkd-btn ghost" onClick={closeReport}>Close</button>
                </div>
              </>
            ) : (
              <>
                <h3>Good news — it&apos;s not cancelled</h3>
                <p>{reportResult.message}</p>
                {reportResult.helpline && (
                  <p className="zkd-help">
                    Helpline:{' '}
                    <a href={`tel:${reportResult.helpline.replace(/\s+/g, '')}`}>{reportResult.helpline}</a>
                  </p>
                )}
                <div className="zkd-modal-acts">
                  <button className="zkd-btn primary" onClick={closeReport}>Got it</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
