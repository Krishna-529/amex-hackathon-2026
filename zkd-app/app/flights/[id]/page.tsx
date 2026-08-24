'use client';

import Link from 'next/link';
import { use, useEffect, useState } from 'react';
import { notFound } from 'next/navigation';
import { useWorld } from '@/components/WorldProvider';
import RouteLine from '@/components/Route';
import { usePoll } from '@/lib/usePoll';
import { BAND_LABEL, BAND_SAY, type Band } from '@/lib/thresholds';
import { OUTCOME } from '@/lib/outcome';
import { hhmm, mins, dayLabel, money } from '@/lib/time';
import { roomsFor, vehiclesFor } from '@/lib/partyCost';
import type { FlightDetail, FlightForecast, ReverifyResult, PreAuthResponse, IntentResponse } from '@/lib/apiTypes';
import type { PastFlight } from '@/server/domain/types';
import { HistoryPanel, ExplanationPanel } from '@/components/ForecastAudit';
import { FlightDetailSkeleton, RiskBodySkeleton } from '@/components/PageSkeletons';
import { AnimatedScore } from '@/components/AnimatedScore';
import { IntentChat } from '@/components/IntentChat';

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

  // Free-text intent, via the IntentChat component below. This is a PREVIEW:
  // nothing it returns is applied to the member's profile or to any recovery
  // until they confirm, which is what makes it safe to let a language model
  // near the input at all — see components/IntentChat.tsx and
  // server/preferences/intent.ts.
  const [intent, setIntent] = useState<IntentResponse | null>(null);

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

  // Passed to IntentChat: it owns the conversation and the network call, this
  // page only owns what a result DOES to the ranking, exactly as `ask()` used
  // to before the chat replaced it.
  const onIntentResult = (r: IntentResponse) => {
    setIntent(r);
    // Move the selection to the new leader, but only when we understood them
    // and something survived their own rules.
    if (r.understood && r.options?.length) setAltId((r.options.find((o) => o.ok) ?? r.options[0]).id);
  };
  const onIntentReset = () => setIntent(null);

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
      setIntent(null);
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
  // already decided. Either way the member is looking at a real ranking.
  const rankedAlts = (intent?.understood && intent.options?.length
    ? (intent.options
        .map((o) => usableAlts.find((a) => a.id === o.id))
        .filter(Boolean) as typeof usableAlts)
    : usableAlts
  );

  // Capped to 5 — a member choosing a replacement does not want to scroll a
  // whole inventory. Within that 5, real coverage of a >6h-later arrival is
  // guaranteed when one genuinely exists in the pool: the arrival-time
  // scorer criterion means a badly-delayed option almost never survives into
  // a pure top-5-by-score, which would make it easy to never actually see —
  // and never see — the hotel/duty-of-care path this app also builds
  // (server/domain/refund.ts's overnight entitlement, the hotel candidates
  // below). Never more than 2 such slots, and never at the cost of every
  // on-time option: this reserves room within the existing 5, it doesn't
  // grow the list or invent an option that isn't already a real, ranked
  // candidate for this flight.
  const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
  const originalArrivesAt = arr.getTime();
  const isMuchLater = (a: (typeof rankedAlts)[number]) =>
    typeof a.arrivesAt === 'number' && a.arrivesAt - originalArrivesAt > SIX_HOURS_MS;

  const onTime = rankedAlts.filter((a) => !isMuchLater(a));
  const muchLater = rankedAlts.filter(isMuchLater);
  const delayedSlots = Math.min(2, muchLater.length, 4); // leaves at least 1 on-time slot
  const orderedAlts = muchLater.length === 0
    ? rankedAlts.slice(0, 5)
    : [...onTime.slice(0, 5 - delayedSlots), ...muchLater.slice(0, delayedSlots)];

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

      {/* ── the emergency exit, first, before anything else ─────────────────
          Everything else on this page assumes time to read it. A member
          standing at a gate that has already been cancelled does not have
          that time and should not have to scroll past a risk score to find
          this — so it is now the very first thing on the page, sticky while
          scrolling, and named as the action it triggers rather than as a
          status question ("Already cancelled?" told you what it checks, not
          what tapping it does). */}
      <div className={`urgent-strip${reportResult && !reportOpen && reportResult.status === 'cancelled' ? ' resolved' : ''}`}>
        <div className="urgent-strip-body">
          <span className="urgent-strip-ic" aria-hidden="true">
            {reportResult && !reportOpen && reportResult.status === 'cancelled' ? '✓' : '⚠'}
          </span>
          <div className="urgent-strip-text">
            <span className="urgent-strip-title">
              {reportResult && !reportOpen && reportResult.status === 'cancelled'
                ? 'Reported — we\u2019re already rebooking you'
                : 'Flight already cancelled?'}
            </span>
            <span className="urgent-strip-sub">
              {reportResult && !reportOpen
                ? reportResult.message
                : 'Skip the wait — tell us now and we start rebooking immediately, no charge without asking first.'}
            </span>
          </div>
        </div>
        {!(reportResult && !reportOpen) && (
          <button className="urgent-strip-btn" onClick={openReport}>Report it now →</button>
        )}
      </div>

      {/* ── the risk score, now the first thing after the emergency exit ────
          Moved up from the two-column detail section below: this is the
          headline number the rest of the page explains, so it reads first,
          not third. */}
      <div className="g gauge hero-gauge" style={{ marginBottom: 16 }}>
        <div className="ringwrap">
          <svg width="210" height="210" viewBox="0 0 210 210">
            <defs>
              <linearGradient id="gr" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor={stops[0]} />
                <stop offset="100%" stopColor={stops[1]} />
              </linearGradient>
            </defs>
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

      {/* ── THE thing this page exists for, first, full width ────────────
          A member's most urgent question on this screen is "what happens if
          this cancels", not "how risky is it" — the risk number two sections
          down matters BECAUSE of what it triggers here, not for its own
          sake. Renamed from "If this one goes": this is the plan already
          sitting ready, not a hypothetical. */}
      <div className="g panel hero-plan" style={{ marginBottom: 16 }}>
        <h3><span className="hero-ic" aria-hidden="true">🛡️</span> Already lined up for you</h3>
        <p style={{ margin: '0 0 14px', color: 'var(--mist)', fontSize: 13.5, lineHeight: 1.6 }}>
          {usableAlts.length === 0 ? (
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
        {orderedAlts.length > 0 && (() => {
          const isPreviewOnly = (row: typeof orderedAlts[number]) => row.why?.startsWith('Generated inventory');
          const bookable = orderedAlts.filter((a) => !isPreviewOnly(a));
          const cheapestFare = bookable.length ? Math.min(...bookable.map((a) => a.partyFare)) : null;
          let cheapestTagged = false;

          return (
            <div className="alt-list">
              {orderedAlts.map((a, i) => {
                const needsOvernight = isMuchLater(a);
                const rowHotelCost = needsOvernight ? hotelCost : 0;
                const rowCabCost = needsOvernight ? cabCost : 0;
                const rowDelta = a.partyFare + rowHotelCost + rowCabCost - refundTotal;
                const picked = planning && a.id === alt?.id;
                const preview = isPreviewOnly(a);
                let badge: 'Recommended' | 'Cheapest' | 'Preview only' | null = null;
                if (preview) {
                  badge = 'Preview only';
                } else if (i === 0) {
                  badge = 'Recommended';
                } else if (cheapestFare !== null && a.partyFare === cheapestFare && !cheapestTagged) {
                  badge = 'Cheapest';
                  cheapestTagged = true;
                }
                return (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => planning && setAltId(a.id)}
                    disabled={!planning}
                    className={`alt-card${picked ? ' picked' : ''}${!planning ? ' readonly' : ''}`}
                  >
                    <div className="alt-card-top">
                      <div className="alt-card-flight">
                        <span className={`alt-check${picked ? ' on' : ''}`} aria-hidden="true">
                          {picked ? '✓' : ''}
                        </span>
                        <span className="alt-code">{a.code}</span>
                        <span className="alt-dep">departs {a.dep}</span>
                      </div>
                      {badge && (
                        <span className={`alt-badge${badge === 'Cheapest' ? ' cheapest' : badge === 'Preview only' ? ' preview' : ''}`}>
                          {badge === 'Recommended' && <span aria-hidden="true">★ </span>}
                          {badge}
                        </span>
                      )}
                    </div>
                    {a.why && <p className="alt-why">{a.why}</p>}

                    {needsOvernight && (hotel || cab) && (
                      <div className="alt-overnight">
                        <div className="alt-overnight-lbl">
                          <span aria-hidden="true">🌙</span> Also means an overnight — here&apos;s the full plan
                        </div>
                        {hotel && (
                          <div className="alt-overnight-row">
                            <span className="alt-overnight-ic" aria-hidden="true">🏨</span>
                            <span className="alt-overnight-name">{hotel.name}</span>
                            <span className="alt-overnight-note">{hotel.area}</span>
                          </div>
                        )}
                        {cab && (
                          <div className="alt-overnight-row">
                            <span className="alt-overnight-ic" aria-hidden="true">🚗</span>
                            <span className="alt-overnight-name">{cab.kind} transfer</span>
                            {rooms > 1 && vehicles > 1 && <span className="alt-overnight-note">× {vehicles}</span>}
                          </div>
                        )}
                      </div>
                    )}

                    <div className="alt-card-price">
                      {!refundKnown ? (
                        <>
                          <span className="alt-fare">{money(a.partyFare, a.currency)}</span>
                          <span className="alt-refund-pending">refund not known yet</span>
                        </>
                      ) : (
                        <>
                          <span className="alt-fare">{money(a.partyFare, a.currency)}</span>
                          {needsOvernight && (rowHotelCost > 0 || rowCabCost > 0) && (
                            <span className="alt-refund-pending">+ {money(rowHotelCost + rowCabCost)} stay</span>
                          )}
                          <span className="alt-arrow" aria-hidden="true">→</span>
                          <span className={`alt-delta ${rowDelta <= 0 ? 'ok' : 'warn'}`}>
                            {rowDelta > 0 ? money(rowDelta) : rowDelta < 0 ? `${money(-rowDelta)} back` : money(0)}
                          </span>
                          <span className="alt-refund-pending">after refund</span>
                        </>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          );
        })()}

        {planning && (
          <div style={{ marginTop: 14 }}>
            <IntentChat flightId={id} onResult={onIntentResult} onReset={onIntentReset} />
          </div>
        )}
      </div>

      {planning && (
        <div className="g panel receipt" style={{ marginBottom: 16 }}>
          <h3>If it does cancel, here is the plan</h3>
          <div className="receipt-lines">
            {partySize > 1 && (
              <div className="receipt-line">
                <span className="receipt-ic" aria-hidden="true">👥</span>
                <span className="receipt-label">Party</span>
                <span className="receipt-value">{partySize} travellers · {rooms} room{rooms === 1 ? '' : 's'} · {vehicles} cab{vehicles === 1 ? '' : 's'}</span>
              </div>
            )}
            {alt && (
              <div className="receipt-line">
                <span className="receipt-ic" aria-hidden="true">✈️</span>
                <span className="receipt-label">Flight</span>
                <span className="receipt-value">{alt.code} · arrives {alt.arr}</span>
                <span className="receipt-amount">{money(alt.partyFare, alt.currency)}</span>
              </div>
            )}
            {hotel && (
              <div className="receipt-line">
                <span className="receipt-ic" aria-hidden="true">🏨</span>
                <span className="receipt-label">Room{rooms > 1 ? 's' : ''} tonight</span>
                <span className="receipt-value">{hotel.name} · {hotel.area}</span>
                <span className="receipt-amount">{hotelCost ? money(hotelCost) : 'covered'}</span>
              </div>
            )}
            {cab && (
              <div className="receipt-line">
                <span className="receipt-ic" aria-hidden="true">🚗</span>
                <span className="receipt-label">Transfers</span>
                <span className="receipt-value">{cab.kind}{vehicles > 1 ? ` × ${vehicles}` : ''}</span>
                <span className="receipt-amount">{cabCost ? money(cabCost) : 'covered'}</span>
              </div>
            )}
          </div>

          <div className="receipt-totals">
            <div className="receipt-total-row">
              <span>This plan costs</span>
              <span className={owed ? 'warn' : 'ok'}>{owed ? money(owed) : 'nothing'}</span>
            </div>
            <div className="receipt-total-row">
              <span>Comes back to your card</span>
              <span className={refundKnown && refundTotal > 0 ? 'ok' : ''}>
                {refundKnown ? (refundTotal > 0 ? money(refundTotal) : 'nothing') : 'not known yet'}
              </span>
            </div>
            <div className="receipt-total-row grand">
              <span>You end up paying</span>
              <span className={delta > 0 ? 'warn' : 'ok'}>
                {!refundKnown ? `${money(owed)} before any refund`
                  : delta > 0 ? money(delta)
                    : delta < 0 ? `${money(-delta)} back to you`
                      : 'nothing'}
              </span>
            </div>
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
      )}

      {/* Boarding pass and its own prediction history side by side — two cards
          of comparable height, so neither column runs out of content while
          the other keeps going (the failure mode a single lopsided pairing
          hit earlier: see globals.css's .split comment history). */}
      <div className="split">
        <div className="g panel boarding-pass">
          <div className="bp-main">
            <div className="bp-row-top">
              <span className="bp-code">{f.code}</span>
              {f.booking && <span className="bp-class">{f.booking.cabin}</span>}
            </div>
            <div className="bp-route">
              <span className="bp-city">{f.from}</span>
              <span className="bp-plane" aria-hidden="true">✈</span>
              <span className="bp-city">{f.to}</span>
            </div>
            <div className="bp-grid">
              <div className="bp-cell">
                <span className="bp-lbl">Terminal</span>
                <span className="bp-val">{f.terminal}</span>
              </div>
              {f.booking && f.booking.partySize > 1 ? (
                <>
                  <div className="bp-cell">
                    <span className="bp-lbl">Travellers</span>
                    <span className="bp-val">{f.booking.partySize}</span>
                  </div>
                  <div className="bp-cell">
                    <span className="bp-lbl">Seats</span>
                    <span className="bp-val">{f.booking.travellers.map((t) => t.seat).join(', ')}</span>
                  </div>
                </>
              ) : (
                <div className="bp-cell">
                  <span className="bp-lbl">Seat</span>
                  <span className="bp-val">{f.booking?.seat}</span>
                </div>
              )}
              <div className="bp-cell">
                <span className="bp-lbl">Reference</span>
                <span className="bp-val mono">{f.booking?.pnr}</span>
              </div>
            </div>
          </div>
          <div className="bp-perf" aria-hidden="true" />
          <div className="bp-stub">
            <span className="bp-lbl">You&apos;ve flown this route</span>
            <span className="bp-val">{rec.flown}× · {rec.cancelled} cancelled</span>
          </div>
        </div>

        {fc && <HistoryPanel forecast={fc} history={detail.forecastHistory} depISO={f.depISO} />}
      </div>

      {fc && (
        <div style={{ marginTop: 16 }}>
          <ExplanationPanel forecast={fc} />
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
