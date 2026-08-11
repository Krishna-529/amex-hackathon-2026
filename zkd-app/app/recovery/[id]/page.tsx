'use client';

import Link from 'next/link';
import { use, useCallback, useEffect, useRef, useState } from 'react';
import { useWorld } from '@/components/WorldProvider';
import {
  WARM_STEPS, DECIDE_STEPS, ACT_STEPS,
  WARM_TOTAL, DECIDE_TOTAL, ACT_TOTAL, MACHINE_TOTAL,
  QUIET_WINDOW_SECONDS, type Step,
} from '@/lib/recovery';
import { secs, money, agoLabel } from '@/lib/time';
import { AIRPORTS } from '@/lib/airports';
import SandboxNotice from '@/components/SandboxNotice';
import type { DisruptionResolution } from '@/lib/apiTypes';

type Phase = 'deciding' | 'waiting' | 'choosing' | 'acting' | 'booked' | 'handed';

/** playback: 1 second of real budget → this many ms on screen */
const PLAY = 190;
const FLOOR = 260;
/** Real seconds. The 90-second window is the member's time to think, so it is
 *  not compressed — 1.5 minutes is the point, not an inconvenience. */
const TICK = 1000;

export default function RecoveryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const {
    world, consent, chosen, setChosen, rejected, reject, setSettled, preAuth,
    live, refreshAlts, refreshHotels, refreshDisruption, resolveDisruption,
  } = useWorld();

  const [phase, setPhase] = useState<Phase>('deciding');
  const [shown, setShown] = useState<Step[]>([]);
  const [left, setLeft] = useState(QUIET_WINDOW_SECONDS);
  const [note, setNote] = useState<string | null>(null);
  const [hotelId, setHotelId] = useState('h1');
  const [cabId, setCabId] = useState('c1');
  const started = useRef(false);

  const liveAlts = live.alts.status === 'ok' ? live.alts.data ?? [] : [];
  const liveHotels = live.hotels.status === 'ok' ? live.hotels.data ?? [] : [];
  const pick = [...(world?.alts ?? []), ...liveAlts].find((a) => a.id === chosen);
  const hotel = [...(world?.hotels ?? []), ...liveHotels].find((h) => h.id === hotelId) ?? world?.hotels[0];
  const cab = world?.cabs.find((c) => c.id === cabId) ?? world?.cabs[0];
  // Mock hotels price via `extra` (rate always 0); live LiteAPI hotels price via
  // `rate` (extra always 0) — one of the two is always the real cost.
  const hotelCost = hotel ? hotel.extra || hotel.rate : 0;
  const owedNow = (pick?.fare ?? 0) + hotelCost + (cab?.extra ?? 0);

  // The canonical "when did this land" clock — fetched once, shared by every
  // viewer of this flight (laptop, phone, a second tab), so the 90-second
  // window counts down from the same real moment everywhere instead of from
  // whenever each client happened to open this page. See server/disruptionState.ts.
  useEffect(() => {
    if (!world) return;
    refreshDisruption(id);
  }, [world, id]);
  const disruption = live.disruption[id];
  const detectedAt = disruption?.data?.detectedAt;

  /** Land on a resolution's outcome — whether it's the one THIS client just
   *  reported, or one discovered already set by another device. `setNote`'s
   *  functional update means a caller's own specific note (set just before
   *  calling this) is kept; a bare discovery gets a generic fallback. */
  const applyResolution = useCallback((resolution: DisruptionResolution) => {
    if (resolution.kind === 'handed-over') {
      setNote((n) => n ?? 'The consent window closed without a response — nothing was booked, nothing was charged.');
      setPhase('handed');
      return;
    }
    setChosen(resolution.altId);
    setHotelId(resolution.hotelId);
    setCabId(resolution.cabId);
    setNote((n) => n ?? "No one answered in time, so autopilot went ahead — that's the permission that was set.");
    setPhase('acting');
  }, [setChosen]);

  /** The window ran out with nobody watching (or this viewer's own countdown
   *  hit zero) — apply the same silence rule a live viewer would get, and
   *  report it so it becomes canonical for every other viewer too. */
  const settleExpired = useCallback(() => {
    // Silence means different things depending on what you asked for — but
    // consent gates SPENDING, not care. If the recovery costs you nothing
    // there is nothing to consent to, and stranding you because you didn't
    // pick up is a worse outcome than a free seat you didn't ask for.
    let resolution: DisruptionResolution;
    if (consent === 'autopilot') {
      setNote("You didn't answer, so we went ahead — that's the permission you gave us.");
      resolution = { kind: 'autopilot', at: Date.now(), altId: chosen, hotelId, cabId };
    } else if (owedNow === 0) {
      setNote("You didn't answer. This costs you nothing, so we booked it rather than leave you stranded — there was no spend to ask about. You can still change it with us.");
      resolution = { kind: 'autopilot', at: Date.now(), altId: chosen, hotelId, cabId };
    } else {
      setNote(`You didn't answer, and this one would cost you ${money(owedNow)} — so we stopped. Nothing was booked and nothing was charged. Your seats are still held.`);
      resolution = { kind: 'handed-over', at: Date.now() };
    }
    resolveDisruption(id, resolution).then((state) => applyResolution(state.resolution!));
  }, [consent, owedNow, chosen, hotelId, cabId, id, resolveDisruption, applyResolution]);

  /* ── phase 1: figure out where in the real timeline we actually are ──── */
  useEffect(() => {
    if (!world || !disruption || disruption.status !== 'ok' || !detectedAt || started.current) return;
    started.current = true;

    const existing = disruption.data!.resolution;
    if (existing) {
      // Already resolved — by autopilot, by this member on another device, or
      // by this same page in a prior render. Nothing left to decide or wait
      // for; skip straight to the outcome (the booking animation still plays,
      // since that's presentational, not a re-decision).
      setShown(DECIDE_STEPS);
      applyResolution(existing);
      return;
    }

    const windowExpiresAt = detectedAt + QUIET_WINDOW_SECONDS * 1000;

    const finishDecide = () => {
      // A pre-authorisation is the member's decision, already given. The only
      // reason to open the window is if the plan they approved is no longer
      // available — substituting silently would break the one promise we make.
      const planIntact = preAuth
        && world.alts.find((a) => a.id === preAuth.altId)?.ok
        && world.hotels.find((h) => h.id === preAuth.hotelId)?.ok
        && world.cabs.find((c) => c.id === preAuth.cabId)?.ok;
      if (preAuth && planIntact) {
        setNote('You authorised this in advance, so there was no window to wait for — we acted the moment the airline filed.');
        resolveDisruption(id, { kind: 'approved', at: Date.now(), altId: preAuth.altId, hotelId: preAuth.hotelId, cabId: preAuth.cabId })
          .then((state) => applyResolution(state.resolution!));
        return;
      }
      if (preAuth && !planIntact) {
        setNote('You had authorised a plan, but part of it is no longer available. We are not substituting something you never saw — over to you.');
      }

      const remaining = windowExpiresAt - Date.now();
      if (remaining <= 0) {
        // Nobody was watching when the real clock ran out.
        settleExpired();
        return;
      }
      setLeft(Math.ceil(remaining / 1000));
      setPhase('waiting');
    };

    let i = 0;
    const run = () => {
      if (i >= DECIDE_STEPS.length) { finishDecide(); return; }
      const s = DECIDE_STEPS[i];
      setShown((p) => [...p, s]);
      i += 1;
      setTimeout(run, Math.max(FLOOR, s.d * PLAY));
    };
    run();
  }, [world, disruption, detectedAt]);

  /* ── phase 2: the member's 90 seconds, ticking off the real clock ────── */
  useEffect(() => {
    if (phase !== 'waiting' || !detectedAt) return;
    const windowExpiresAt = detectedAt + QUIET_WINDOW_SECONDS * 1000;
    const t = setInterval(() => {
      const remaining = windowExpiresAt - Date.now();
      if (remaining <= 0) {
        clearInterval(t);
        settleExpired();
        return;
      }
      setLeft(Math.ceil(remaining / 1000));
    }, TICK);
    return () => clearInterval(t);
  }, [phase, detectedAt, settleExpired]);

  /* ── phase 3: the irreversible half ───────────────────────────────── */
  useEffect(() => {
    if (phase !== 'acting') return;
    let i = 0;
    const run = () => {
      if (i >= ACT_STEPS.length) { setPhase('booked'); return; }
      const s = ACT_STEPS[i];
      setShown((p) => [...p, s]);
      i += 1;
      setTimeout(run, Math.max(FLOOR, s.d * PLAY));
    };
    run();
  }, [phase]);

  useEffect(() => {
    if (phase === 'booked') setSettled('booked');
    if (phase === 'handed') setSettled('handed-over');
  }, [phase, setSettled]);

  // On-demand only — guarded at the provider level, so if the member already
  // visited /prepare this session this is a no-op and reuses that result.
  useEffect(() => {
    if (!world) return;
    const f0 = world.upcoming[0];
    const day = 24 * 60 * 60 * 1000;
    const dateISO = new Date(world.now.getTime() + 14 * day).toISOString().slice(0, 10);
    refreshAlts(f0.from, f0.to, dateISO, 'Economy');
    const city = AIRPORTS[f0.to]?.city;
    if (city) {
      const checkout = new Date(world.now.getTime() + 15 * day).toISOString().slice(0, 10);
      refreshHotels(city, dateISO, checkout);
    }
  }, [world]);

  const approve = useCallback(() => {
    setNote('You approved it, so we went straight through.');
    resolveDisruption(id, { kind: 'approved', at: Date.now(), altId: chosen, hotelId, cabId })
      .then((state) => applyResolution(state.resolution!));
  }, [id, chosen, hotelId, cabId, resolveDisruption, applyResolution]);

  const handOver = useCallback(() => {
    setNote('You took the wheel. We stopped immediately — nothing confirmed, nothing paid, and your held seats stay held.');
    resolveDisruption(id, { kind: 'handed-over', at: Date.now() })
      .then((state) => applyResolution(state.resolution!));
  }, [id, resolveDisruption, applyResolution]);

  /* opening the options is itself an intervention: hold the clock */
  const browse = useCallback(() => {
    setNote('You stepped in, so the clock is held. Nothing proceeds while you are deciding.');
    setPhase('choosing');
  }, []);

  const choose = useCallback((altId: string) => {
    // The one we were about to book is now permanently rejected, and that
    // exclusion is a policy input — not a preference the planner may ignore.
    if (chosen !== altId) reject(chosen);
    setChosen(altId);
    setNote('Swapped. The one we had picked is now permanently excluded — it can never be re-proposed.');
    setPhase('waiting');
  }, [chosen, reject, setChosen]);

  if (!world || !pick || !hotel || !cab) return <div className="page-h"><h1>Recovering your trip</h1></div>;

  const body = (s: Step) =>
    s.live === 'seat'
      ? `${pick.code} at ${pick.dep}, seat 14C. The airline cancelled, so the fare difference is theirs — you pay nothing.`
      : s.live === 'van'
        ? `A single-use card locked to ${owed ? money(owed) : '₹0'} and today's date — exactly the plan you were shown, and it cannot be reused or overspent.`
      : s.live === 'hotel'
        ? `${hotel.name}, check-in ${hotel.checkin}. ${hotel.why}.`
      : s.live === 'cab'
        ? `${cab.kind} booked for both legs — ${world.cabLegs[0].from} → ${world.cabLegs[0].to} at ${world.cabLegs[0].pickup}, and back at ${world.cabLegs[1].pickup}.`
      : s.live === 'onward'
        ? `${world.upcoming[1].code} to London at ${world.upcoming[1].dep} re-checked and still valid — a no-show on the first leg can silently void the rest of an itinerary.`
        : s.s;

  const elapsed = shown.reduce((a, s) => a + s.d, 0);
  const bookable = world.alts.filter((a) => a.ok && !rejected.includes(a.id));
  /* what the member actually ends up paying, from what they actually picked */
  const owed = pick.fare + hotelCost + cab.extra;

  return (
    <div className="skeleton">
      <Link href="/flights" className="back">← All flights</Link>
      <div className="page-h" style={{ padding: '0 0 26px' }}>
        <h1>AI 2803 was cancelled</h1>
        <p>
          MAA → DEL, was due to depart {world.upcoming[0].dep} today.
          Detected {agoLabel(detectedAt ? new Date(detectedAt) : world.detected, new Date())}.
        </p>
      </div>
      <div className="split">
        <div>
          {/* everything that happened before the cancellation */}
          <div className="g flow" style={{ marginBottom: 16 }}>
            <h3>
              Before it was cancelled
              <span className="timer" style={{ float: 'right', textTransform: 'none' }}>
                {secs(WARM_TOTAL)} · already done
              </span>
            </h3>
            <p className="phase-note">
              Your flight was flagged at risk hours ago, so this ran then — off the critical path, with
              nothing booked and nothing spent. It is the only reason the part below takes seconds.
            </p>
            <div className="tl">
              {WARM_STEPS.map((s) => (
                <div className="ev done warm" key={s.n}>
                  <div className="h"><span className="n">{s.n}</span><span className="t">{secs(s.d)}</span></div>
                  <div className="s">{s.s}</div>
                </div>
              ))}
            </div>
          </div>

          {/* the live half */}
          <div className="g flow">
            <h3>
              The moment it was cancelled
              <span className="timer" style={{ float: 'right', textTransform: 'none' }}>
                {secs(elapsed)}{phase === 'booked' ? ` of ${secs(MACHINE_TOTAL)}` : ''}
              </span>
            </h3>
            <p className="phase-note">
              {preAuth
                ? 'You authorised this beforehand, so there was no waiting on a human at all — this is the entire recovery.'
                : 'Machine time only. The 90 seconds you get to object is yours, and is not counted here.'}
            </p>

            <div className="tl">
              {shown.map((s, i) => (
                <div className={`ev ${i === shown.length - 1 && (phase === 'deciding' || phase === 'acting') ? 'busy' : 'done'}`} key={`${s.n}-${i}`}>
                  <div className="h"><span className="n">{s.n}</span><span className="t">{secs(s.d)}</span></div>
                  <div className="s">{body(s)}</div>
                </div>
              ))}

              {/* ── the consent gate ─────────────────────────────────── */}
              {(phase === 'waiting' || phase === 'choosing') && (
                <div className={`gate ${phase === 'choosing' ? 'paused' : ''}`}>
                  <div className="gate-h">
                    <span className="lbl">
                      {consent === 'autopilot' ? 'Booking unless you stop us' : 'Waiting for you'}
                    </span>
                    <span className="cd">{left}s</span>
                  </div>
                  <div className="bar">
                    <i style={{ width: `${(left / QUIET_WINDOW_SECONDS) * 100}%` }} />
                  </div>

                  {phase === 'waiting' ? (
                    <>
                      <p>
                        Here is the whole plan — the flight, the room and both cab legs.
                        {consent === 'autopilot'
                          ? ' If you say nothing, we book all of it.'
                          : owedNow === 0
                            ? " You asked to be consulted first — but this costs you nothing, so if you don't answer we'll book it rather than leave you stranded."
                            : ` You asked to be consulted first, and this would cost you ${money(owedNow)} — so if you don't answer, we stop.`}
                      </p>

                      <div className="plan-grp">
                        <div className="lbl">Flight</div>
                        <div className="line-item">
                          <span className="ic">✈</span>
                          <span className="l">
                            <span className="t1">{pick.code} · {pick.dep}</span>
                            <span className="t2">arrives {pick.arr} · {pick.cabin} · seat 14C</span>
                          </span>
                          <span className={`r ${pick.fare ? '' : 'free'}`}>
                            {pick.fare ? money(pick.fare) : 'no cost'}
                          </span>
                        </div>
                      </div>

                      <div className="plan-grp">
                        <div className="lbl">Room tonight</div>
                        <div className="line-item">
                          <span className="ic">BED</span>
                          <span className="l">
                            <span className="t1">{hotel.name}</span>
                            <span className="t2">{hotel.area} · check-in {hotel.checkin} · {hotel.walk}</span>
                          </span>
                          <span className={`r ${hotelCost ? '' : 'free'}`}>
                            {hotelCost ? money(hotelCost) : 'airline pays'}
                          </span>
                        </div>
                      </div>

                      <div className="plan-grp">
                        <div className="lbl">Cab · {cab.kind}</div>
                        {world.cabLegs.map((l) => (
                          <div className="line-item" key={l.id}>
                            <span className="ic">CAB</span>
                            <span className="l">
                              <span className="t1">{l.from} → {l.to}</span>
                              <span className="t2">{cab.kind} · pickup {l.pickup} · {l.note}</span>
                            </span>
                            <span className={`r ${cab.extra ? '' : 'free'}`}>
                              {cab.extra ? money(cab.extra / 2) : 'airline pays'}
                            </span>
                          </div>
                        ))}
                      </div>
                      <div className="acts">
                        <button className="go" onClick={approve}>Yes, book it now</button>
                        <button onClick={browse}>Show me other options</button>
                        <button onClick={handOver}>I&apos;ll take it from here</button>
                      </div>
                    </>
                  ) : (
                    <>
                      <p>
                        {bookable.length} of {world.alts.length} work for you. The rest are blocked by your own
                        policy — we&apos;ll tell you which rule, not just &ldquo;unavailable&rdquo;.
                      </p>
                      <div className="lbl" style={{ fontFamily: 'var(--mono)', fontSize: 9,
                        letterSpacing: '.16em', textTransform: 'uppercase',
                        color: 'var(--mist2)', margin: '4px 0 9px' }}>Flights</div>
                      <div className="opts">
                        {world.alts.map((a) => {
                          const excluded = rejected.includes(a.id);
                          const usable = a.ok && !excluded;
                          return (
                            <button
                              key={a.id}
                              className={`opt ${usable ? '' : 'no'} ${a.id === chosen ? 'pick' : ''}`}
                              disabled={!usable}
                              onClick={() => choose(a.id)}
                            >
                              <span className="l">
                                <span className="fl">{a.code} · {a.dep}</span>
                                <span className="mt">
                                  {excluded
                                    ? 'You rejected this — it can never be re-proposed'
                                    : a.ok
                                      ? `arrives ${a.arr} · ${a.cabin} · ${a.seats} seats left`
                                      : a.why}
                                </span>
                                {a.id === chosen && <span className="rec">✓ we picked this</span>}
                              </span>
                              <span className="r">
                                <span className={`pr ${usable && !a.fare ? 'free' : ''}`}>
                                  {excluded ? 'excluded' : a.ok ? (a.fare ? money(a.fare) : 'no cost to you') : 'not bookable'}
                                </span>
                              </span>
                            </button>
                          );
                        })}
                        {liveAlts.length > 0 && (
                          <>
                            <SandboxNotice kind="flights" />
                            {liveAlts.map((a) => (
                              <button
                                key={a.id}
                                className={`opt ${a.id === chosen ? 'pick' : ''}`}
                                onClick={() => choose(a.id)}
                              >
                                <span className="l">
                                  <span className="fl">{a.code} · {a.dep}</span>
                                  <span className="mt">arrives {a.arr} · {a.cabin}</span>
                                  {a.id === chosen && <span className="rec">✓ we picked this</span>}
                                </span>
                                <span className="r">
                                  <span className="pr">{money(a.fare)}</span>
                                </span>
                              </button>
                            ))}
                          </>
                        )}
                      </div>

                      <div className="lbl" style={{ fontFamily: 'var(--mono)', fontSize: 9,
                        letterSpacing: '.16em', textTransform: 'uppercase',
                        color: 'var(--mist2)', margin: '18px 0 9px' }}>Room tonight</div>
                      <div className="opts">
                        {world.hotels.map((h) => (
                          <button
                            key={h.id}
                            className={`opt ${h.ok ? '' : 'no'} ${h.id === hotelId ? 'pick' : ''}`}
                            disabled={!h.ok}
                            onClick={() => { setHotelId(h.id); setNote(`Room swapped to ${h.name}.`); }}
                          >
                            <span className="l">
                              <span className="fl">{h.name}</span>
                              <span className="mt">{h.ok ? `${h.area} · check-in ${h.checkin}` : h.why}</span>
                              {h.id === hotelId && <span className="rec">✓ we picked this</span>}
                            </span>
                            <span className="r">
                              <span className={`pr ${h.ok && !h.extra ? 'free' : ''}`}>
                                {h.ok ? (h.extra ? `${money(h.extra)} over` : 'airline pays') : 'over the cap'}
                              </span>
                            </span>
                          </button>
                        ))}
                        {liveHotels.length > 0 && (
                          <>
                            <SandboxNotice kind="hotels" />
                            {liveHotels.map((h) => (
                              <button
                                key={h.id}
                                className={`opt ${h.id === hotelId ? 'pick' : ''}`}
                                onClick={() => { setHotelId(h.id); setNote(`Room swapped to ${h.name}.`); }}
                              >
                                <span className="l">
                                  <span className="fl">{h.name}</span>
                                  <span className="mt">{h.area} · check-in {h.checkin}</span>
                                  {h.id === hotelId && <span className="rec">✓ we picked this</span>}
                                </span>
                                <span className="r">
                                  <span className="pr">{money(h.rate)}</span>
                                </span>
                              </button>
                            ))}
                          </>
                        )}
                      </div>

                      <div className="lbl" style={{ fontFamily: 'var(--mono)', fontSize: 9,
                        letterSpacing: '.16em', textTransform: 'uppercase',
                        color: 'var(--mist2)', margin: '18px 0 9px' }}>Cab for both legs</div>
                      <div className="opts">
                        {world.cabs.map((c) => (
                          <button
                            key={c.id}
                            className={`opt ${c.ok ? '' : 'no'} ${c.id === cabId ? 'pick' : ''}`}
                            disabled={!c.ok}
                            onClick={() => { setCabId(c.id); setNote(`Cab swapped to ${c.kind}.`); }}
                          >
                            <span className="l">
                              <span className="fl">{c.kind}</span>
                              <span className="mt">{c.ok ? `up to ${c.seats} seats · ${c.why}` : c.why}</span>
                              {c.id === cabId && <span className="rec">✓ we picked this</span>}
                            </span>
                            <span className="r">
                              <span className={`pr ${c.ok && !c.extra ? 'free' : ''}`}>
                                {c.ok ? (c.extra ? `${money(c.extra)} over` : 'airline pays') : 'over the cap'}
                              </span>
                            </span>
                          </button>
                        ))}
                      </div>

                      <div className="acts" style={{ marginTop: 16 }}>
                        <button className="go" onClick={approve}>Book this plan</button>
                        <button onClick={() => setPhase('waiting')}>Back to the plan</button>
                      </div>
                    </>
                  )}
                </div>
              )}

              {phase === 'handed' && (
                <div className="gate stopped">
                  <div className="gate-h"><span className="lbl">Stopped</span></div>
                  <p>{note}</p>
                  <div className="acts"><Link href="/flights" className="back" style={{ margin: 0 }}>Back to my flights</Link></div>
                </div>
              )}
            </div>
          </div>
        </div>

        <div>
          {note && phase !== 'handed' && (
            <div className="g panel" style={{ marginBottom: 16, borderColor: 'rgba(47,127,240,.3)' }}>
              <h3>Why this happened</h3>
              <p style={{ margin: 0, color: 'var(--mist)', fontSize: 13.5, lineHeight: 1.6 }}>{note}</p>
            </div>
          )}

          {phase === 'booked' && (
            <>
              <div
                className="g panel"
                style={{ marginBottom: 16, borderColor: 'rgba(75,171,124,.34)', background: 'linear-gradient(150deg,rgba(75,171,124,.11),var(--glass))' }}
              >
                <h3 style={{ color: 'var(--safe)' }}>Your trip now</h3>
                <div className="diff">
                  <div className="was"><div className="k">Flight</div><div className="v">AI 2803 · {world.upcoming[0].dep}</div></div>
                  <div className="arw">→</div>
                  <div className="now"><div className="k">Rebooked</div><div className="v">{pick.code} · {pick.dep}</div></div>
                </div>
                <div className="diff">
                  <div className="was">
                    <div className="k">Hotel</div>
                    <div className="v">{world.hotels[0].name}, 14:00</div>
                  </div>
                  <div className="arw">→</div>
                  <div className="now">
                    <div className="k">{hotel.id === 'h1' ? 'Re-timed' : 'Changed'}</div>
                    <div className="v">{hotel.name}, {hotel.checkin}</div>
                  </div>
                </div>
                <div className="diff">
                  <div className="was"><div className="k">Cab</div><div className="v">{world.cabs[0].kind}</div></div>
                  <div className="arw">→</div>
                  <div className="now">
                    <div className="k">{cab.id === 'c1' ? 'Re-timed' : 'Upgraded'}</div>
                    <div className="v">{cab.kind}, both legs</div>
                  </div>
                </div>
                <div className="diff">
                  <div className="was"><div className="k">Record locator</div><div className="v">QK7R2M</div></div>
                  <div className="arw">→</div>
                  <div className="now"><div className="k">Reissued</div><div className="v">RB4T9Z</div></div>
                </div>
                <div className="diff">
                  <div className="was"><div className="k">London leg</div><div className="v">{world.upcoming[1].code} · {world.upcoming[1].dep}</div></div>
                  <div className="arw">→</div>
                  <div className="now"><div className="k">Unchanged</div><div className="v">still valid</div></div>
                </div>
              </div>

              <div className="g panel">
                <h3>What it cost you</h3>
                <div className="kv">
                  <span className="k">Flight fare difference</span>
                  <span className={`v ${pick.fare ? 'warn' : 'ok'}`}>
                    {pick.fare ? money(pick.fare) : 'airline pays'}
                  </span>
                </div>
                <div className="kv">
                  <span className="k">Room · {hotel.name}</span>
                  <span className={`v ${hotelCost ? 'warn' : 'ok'}`}>
                    {hotelCost ? `${money(hotelCost)} over the allowance` : 'airline pays'}
                  </span>
                </div>
                <div className="kv">
                  <span className="k">Cab · {cab.kind}, both legs</span>
                  <span className={`v ${cab.extra ? 'warn' : 'ok'}`}>
                    {cab.extra ? `${money(cab.extra)} over the allowance` : 'airline pays'}
                  </span>
                </div>
                <div className="kv total">
                  <span className="k">Charged to your card</span>
                  <span className={`v ${owed ? 'warn' : 'ok'}`}>{owed ? money(owed) : 'nothing'}</span>
                </div>
                <div className="kv"><span className="k">Decision time</span><span className="v">{secs(DECIDE_TOTAL)}</span></div>
                <div className="kv"><span className="k">Execution time</span><span className="v">{secs(ACT_TOTAL)}</span></div>
                <div className="kv"><span className="k">Prepared in advance</span><span className="v">{secs(WARM_TOTAL)}, before it happened</span></div>
                <Link href="/flights" className="cta ghost" style={{ marginTop: 18, display: 'flex' }}>
                  Back to my flights
                </Link>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
