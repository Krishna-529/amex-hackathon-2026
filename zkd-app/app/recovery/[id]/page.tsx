'use client';

import Link from 'next/link';
import { use } from 'react';
import { useWorld } from '@/components/WorldProvider';
import { usePoll } from '@/lib/usePoll';
import {
  WARM_STEPS, WARM_TOTAL, DECIDE_TOTAL, ACT_TOTAL, MACHINE_TOTAL,
} from '@/lib/recovery';
import { secs, money, agoLabel, hhmm } from '@/lib/time';
import type { RecoveryView, FlightDetail, PreAuthResponse } from '@/lib/apiTypes';
import type { ResolveAction } from '@/server/engine/simulation';
import { RecoverySkeleton } from '@/components/PageSkeletons';

export default function RecoveryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { passengerId, schedule } = useWorld();

  // The server is the only thing deciding anything here — this page polls
  // three read-only views and renders whatever they say. Actions below just
  // POST an intent; the next poll picks up the result, same as any other
  // viewer watching this flight would. None of these carry a passenger id any
  // more — the session on the request IS the passenger.
  const { data: view } = usePoll<RecoveryView>(passengerId ? `/api/disruptions/${id}` : null, 1500);
  const { data: detail } = usePoll<FlightDetail>(passengerId ? `/api/flights/${id}` : null, 5000);
  const { data: preAuth } = usePoll<PreAuthResponse>(passengerId ? `/api/flights/${id}/preauth` : null, 10000);

  const f = schedule?.upcoming.find((x) => x.id === id);
  const booking = f?.booking;

  const act = (action: ResolveAction) => {
    fetch(`/api/disruptions/${id}/consent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    }).catch(() => {});
  };

  if (!schedule || !view || !detail || !f || !booking) return <RecoverySkeleton />;

  const alt = detail.candidates.alts.find((a) => a.id === view.chosenAltId);
  const hotel = detail.candidates.hotels.find((h) => h.id === view.chosenHotelId) ?? detail.candidates.hotels[0];
  const cab = detail.candidates.cabs.find((c) => c.id === view.chosenCabId) ?? detail.candidates.cabs[0];
  const partySize = view.partySize;
  const bookable = detail.candidates.alts.filter((a) => a.ok && !view.rejectedAltIds.includes(a.id));
  const excluded = view.pipeline?.excluded ?? [];
  const elapsed = view.shown.reduce((a, s) => a + s.d, 0);
  const consent = schedule.passenger.consent;

  const waitingNote =
    consent === 'autopilot'
      ? ' If you say nothing, we book all of it.'
      : view.owedNow === 0
        ? " You asked to be consulted first — but this costs you nothing, so if you don't answer we'll book it rather than leave you stranded."
        : ` You asked to be consulted first, and this would cost you ${money(view.owedNow)} — so if you don't answer, we stop.`;

  return (
    <div className="skeleton">
      <Link href="/flights" className="back">← All flights</Link>
      <div className="page-h" style={{ padding: '0 0 26px' }}>
        <h1>{f.code} was cancelled</h1>
        <p>
          {f.from} → {f.to}, was due to depart {hhmm(new Date(f.depISO))} today.
          Detected {agoLabel(new Date(view.detectedAt), new Date())}.
        </p>
      </div>
      <div className="split">
        <div>
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

          <div className="g flow">
            <h3>
              The moment it was cancelled
              <span className="timer" style={{ float: 'right', textTransform: 'none' }}>
                {secs(elapsed)}{view.phase === 'booked' ? ` of ${secs(MACHINE_TOTAL)}` : ''}
              </span>
            </h3>
            <p className="phase-note">
              {preAuth
                ? 'You authorised this beforehand, so there was no waiting on a human at all — this is the entire recovery.'
                : 'Machine time only. The window you get to object is yours, and is not counted here.'}
            </p>

            <div className="tl">
              {view.phase === 'deciding' && (
                <div className="ev busy">
                  <div className="h"><span className="n">Working it out</span></div>
                  <div className="s">Confirming the cancellation and locking in your alternative — a few seconds.</div>
                </div>
              )}

              {view.shown.map((s, i) => (
                <div
                  className={`ev ${i === view.shown.length - 1 && view.phase === 'acting' ? 'busy' : 'done'}`}
                  key={`${s.n}-${i}`}
                >
                  <div className="h"><span className="n">{s.n}</span><span className="t">{secs(s.d)}</span></div>
                  <div className="s">{s.s}</div>
                </div>
              ))}

              {(view.phase === 'waiting' || view.phase === 'choosing') && (
                <div className={`gate ${view.phase === 'choosing' ? 'paused' : ''}`}>
                  <div className="gate-h">
                    <span className="lbl">
                      {consent === 'autopilot' ? 'Booking unless you stop us' : 'Waiting for you'}
                    </span>
                    <span className="cd">{view.secondsLeft}s</span>
                  </div>
                  <div className="bar">
                    <i style={{ width: `${Math.min(100, (view.secondsLeft / Math.max(1, view.windowSeconds)) * 100)}%` }} />
                  </div>

                  {view.phase === 'waiting' && alt && hotel && cab ? (
                    <>
                      <p>Here is the whole plan — the flight, the room and both cab legs.{waitingNote}</p>

                      {partySize > 1 && (
                        <div className="kv" style={{ marginBottom: 4 }}>
                          <span className="k">Party</span>
                          <span className="v">{partySize} travellers · {view.cost.rooms} room{view.cost.rooms === 1 ? '' : 's'} · {view.cost.vehicles} cab{view.cost.vehicles === 1 ? '' : 's'}</span>
                        </div>
                      )}

                      <div className="plan-grp">
                        <div className="lbl">Flight</div>
                        <div className="line-item">
                          <span className="ic">✈</span>
                          <span className="l">
                            <span className="t1">{alt.code} · {alt.dep}</span>
                            <span className="t2">
                              arrives {alt.arr} · {alt.cabin} ·{' '}
                              {partySize > 1 ? `${partySize} seats` : `seat ${booking.seat}`}
                              {alt.kind === 'carrier-protected' && ' · owed by the airline'}
                            </span>
                          </span>
                          <span className={`r ${alt.partyFare ? '' : 'free'}`}>
                            {alt.partyFare ? money(alt.partyFare) : 'no cost'}
                          </span>
                        </div>
                      </div>

                      <div className="plan-grp">
                        <div className="lbl">Room{view.cost.rooms > 1 ? 's' : ''} tonight</div>
                        <div className="line-item">
                          <span className="ic">BED</span>
                          <span className="l">
                            <span className="t1">{hotel.name}</span>
                            <span className="t2">
                              {hotel.area} · check-in {hotel.checkin} · {hotel.walk}
                              {view.cost.rooms > 1 && ` · ${view.cost.rooms} rooms`}
                            </span>
                          </span>
                          <span className={`r ${view.cost.hotel ? '' : 'free'}`}>
                            {view.cost.hotel ? money(view.cost.hotel) : 'airline pays'}
                          </span>
                        </div>
                      </div>

                      <div className="plan-grp">
                        <div className="lbl">{view.cost.vehicles > 1 ? `${view.cost.vehicles} × ${cab.kind}` : `Cab · ${cab.kind}`}</div>
                        {detail.candidates.cabLegs.map((l) => (
                          <div className="line-item" key={l.id}>
                            <span className="ic">CAB</span>
                            <span className="l">
                              <span className="t1">{l.from} → {l.to}</span>
                              <span className="t2">{cab.kind} · pickup {l.pickup} · {l.note}</span>
                            </span>
                            <span className={`r ${view.cost.cab ? '' : 'free'}`}>
                              {view.cost.cab ? money(view.cost.cab / 2) : 'airline pays'}
                            </span>
                          </div>
                        ))}
                      </div>
                      <div className="acts">
                        <button className="go" onClick={() => act({ kind: 'approve' })}>Yes, book it now</button>
                        <button onClick={() => act({ kind: 'browse' })}>Show me other options</button>
                        <button onClick={() => act({ kind: 'hand-over' })}>I&apos;ll take it from here</button>
                      </div>
                    </>
                  ) : view.phase === 'choosing' ? (
                    <>
                      <p>
                        {bookable.length} of {detail.candidates.alts.length} work for you. The rest are blocked by
                        your own policy — we&apos;ll tell you which rule, not just &ldquo;unavailable&rdquo;.
                      </p>
                      {/* That promise used to be copy with nothing behind it.
                          applyHardRules records the rule for every option it
                          removes, so name them. */}
                      {excluded.length > 0 && (
                        <ul className="excl">
                          {excluded.map((x) => (
                            <li key={x.code}><b>{x.code}</b> — {x.rule}</li>
                          ))}
                        </ul>
                      )}
                      <div className="lbl" style={{ fontFamily: 'var(--mono)', fontSize: 9,
                        letterSpacing: '.16em', textTransform: 'uppercase',
                        color: 'var(--mist2)', margin: '4px 0 9px' }}>Flights</div>
                      <div className="opts">
                        {detail.candidates.alts.map((a) => {
                          const excluded = view.rejectedAltIds.includes(a.id);
                          const usable = a.ok && !excluded;
                          return (
                            <button
                              key={a.id}
                              className={`opt ${usable ? '' : 'no'} ${a.id === view.chosenAltId ? 'pick' : ''}`}
                              disabled={!usable}
                              onClick={() => act({ kind: 'choose', altId: a.id })}
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
                                {a.id === view.chosenAltId && <span className="rec">✓ we picked this</span>}
                              </span>
                              <span className="r">
                                <span className={`pr ${usable && !a.partyFare ? 'free' : ''}`}>
                                  {excluded ? 'excluded' : a.ok ? (a.partyFare ? money(a.partyFare) : 'no cost to you') : 'not bookable'}
                                </span>
                              </span>
                            </button>
                          );
                        })}
                      </div>

                      <div className="lbl" style={{ fontFamily: 'var(--mono)', fontSize: 9,
                        letterSpacing: '.16em', textTransform: 'uppercase',
                        color: 'var(--mist2)', margin: '18px 0 9px' }}>Room tonight</div>
                      <div className="opts">
                        {detail.candidates.hotels.map((h) => (
                          <button
                            key={h.id}
                            className={`opt ${h.ok ? '' : 'no'} ${h.id === view.chosenHotelId ? 'pick' : ''}`}
                            disabled={!h.ok}
                            onClick={() => act({ kind: 'swap-hotel', hotelId: h.id })}
                          >
                            <span className="l">
                              <span className="fl">{h.name}</span>
                              <span className="mt">{h.ok ? `${h.area} · check-in ${h.checkin}` : h.why}</span>
                              {h.id === view.chosenHotelId && <span className="rec">✓ we picked this</span>}
                            </span>
                            <span className="r">
                              <span className={`pr ${h.ok && !h.extra ? 'free' : ''}`}>
                                {h.ok ? (h.extra ? `${money(h.extra)} over` : 'airline pays') : 'over the cap'}
                              </span>
                            </span>
                          </button>
                        ))}
                      </div>

                      <div className="lbl" style={{ fontFamily: 'var(--mono)', fontSize: 9,
                        letterSpacing: '.16em', textTransform: 'uppercase',
                        color: 'var(--mist2)', margin: '18px 0 9px' }}>Cab for both legs</div>
                      <div className="opts">
                        {detail.candidates.cabs.map((c) => (
                          <button
                            key={c.id}
                            className={`opt ${c.ok ? '' : 'no'} ${c.id === view.chosenCabId ? 'pick' : ''}`}
                            disabled={!c.ok}
                            onClick={() => act({ kind: 'swap-cab', cabId: c.id })}
                          >
                            <span className="l">
                              <span className="fl">{c.kind}</span>
                              <span className="mt">{c.ok ? `up to ${c.seats} seats · ${c.why}` : c.why}</span>
                              {c.id === view.chosenCabId && <span className="rec">✓ we picked this</span>}
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
                        <button className="go" onClick={() => act({ kind: 'approve' })}>Book this plan</button>
                        <button onClick={() => act({ kind: 'back' })}>Back to the plan</button>
                      </div>
                    </>
                  ) : null}
                </div>
              )}

              {view.phase === 'handed' && (
                <div className="gate stopped">
                  <div className="gate-h"><span className="lbl">Stopped</span></div>
                  <p>{view.note}</p>
                  <div className="acts"><Link href="/flights" className="back" style={{ margin: 0 }}>Back to my flights</Link></div>
                </div>
              )}
            </div>
          </div>
        </div>

        <div>
          {(view.note || view.pipeline?.why) && view.phase !== 'handed' && (
            <div className="g panel" style={{ marginBottom: 16, borderColor: 'rgba(47,127,240,.3)' }}>
              <h3>Why this happened</h3>
              {view.note && (
                <p style={{ margin: 0, color: 'var(--mist)', fontSize: 13.5, lineHeight: 1.6 }}>{view.note}</p>
              )}
              {/* The scorer's own sentence. It was being computed on every
                  recovery and thrown away — the member was shown a ranked list
                  with no statement of what it was ranked on. */}
              {view.pipeline?.why && (
                <p style={{ margin: view.note ? '10px 0 0' : 0, color: 'var(--mist)', fontSize: 13.5, lineHeight: 1.6 }}>
                  {view.pipeline.why}
                </p>
              )}
              {view.pipeline?.heuristicFallback && (
                <p style={{ margin: '10px 0 0', color: 'var(--mist2)', fontSize: 12.5, lineHeight: 1.6 }}>
                  We had not finished scoring every option when your window opened, so this is our
                  safe default rather than the ranked pick. Nothing is lost — you can still browse
                  the full list below.
                </p>
              )}
            </div>
          )}

          {view.phase === 'booked' && alt && hotel && cab && (
            <>
              <div
                className="g panel"
                style={{ marginBottom: 16, borderColor: 'rgba(75,171,124,.34)', background: 'linear-gradient(150deg,rgba(75,171,124,.11),var(--glass))' }}
              >
                <h3 style={{ color: 'var(--safe)' }}>Your trip now</h3>
                <div className="diff">
                  <div className="was"><div className="k">Flight</div><div className="v">{f.code} · {hhmm(new Date(f.depISO))}</div></div>
                  <div className="arw">→</div>
                  <div className="now"><div className="k">Rebooked</div><div className="v">{alt.code} · {alt.dep}</div></div>
                </div>
                <div className="diff">
                  <div className="was">
                    <div className="k">Hotel</div>
                    <div className="v">{detail.candidates.hotels[0].name}, 14:00</div>
                  </div>
                  <div className="arw">→</div>
                  <div className="now">
                    <div className="k">{hotel.id === detail.candidates.hotels[0].id ? 'Re-timed' : 'Changed'}</div>
                    <div className="v">{hotel.name}, {hotel.checkin}</div>
                  </div>
                </div>
                <div className="diff">
                  <div className="was"><div className="k">Cab</div><div className="v">{detail.candidates.cabs[0].kind}</div></div>
                  <div className="arw">→</div>
                  <div className="now">
                    <div className="k">{cab.id === detail.candidates.cabs[0].id ? 'Re-timed' : 'Upgraded'}</div>
                    <div className="v">{cab.kind}, both legs</div>
                  </div>
                </div>
                <div className="diff">
                  <div className="was"><div className="k">Record locator</div><div className="v">{booking.pnr}</div></div>
                  <div className="arw">→</div>
                  <div className="now"><div className="k">Reissued</div><div className="v">new reference on file</div></div>
                </div>
              </div>

              <div className="g panel">
                <h3>What it cost you</h3>
                {partySize > 1 && (
                  <div className="kv"><span className="k">Party</span><span className="v">{partySize} travellers</span></div>
                )}
                <div className="kv">
                  <span className="k">Flight fare difference{partySize > 1 ? ` · ${partySize} tickets` : ''}</span>
                  <span className={`v ${view.cost.fare ? 'warn' : 'ok'}`}>
                    {view.cost.fare ? money(view.cost.fare) : 'airline pays'}
                  </span>
                </div>
                <div className="kv">
                  <span className="k">Room · {hotel.name}{view.cost.rooms > 1 ? ` · ${view.cost.rooms} rooms` : ''}</span>
                  <span className={`v ${view.cost.hotel ? 'warn' : 'ok'}`}>
                    {view.cost.hotel ? `${money(view.cost.hotel)} over the allowance` : 'airline pays'}
                  </span>
                </div>
                <div className="kv">
                  <span className="k">Cab · {cab.kind}, both legs{view.cost.vehicles > 1 ? ` · ${view.cost.vehicles} vehicles` : ''}</span>
                  <span className={`v ${view.cost.cab ? 'warn' : 'ok'}`}>
                    {view.cost.cab ? `${money(view.cost.cab)} over the allowance` : 'airline pays'}
                  </span>
                </div>
                <div className="kv total">
                  <span className="k">Charged to your card</span>
                  <span className={`v ${view.owedNow ? 'warn' : 'ok'}`}>{view.owedNow ? money(view.owedNow) : 'nothing'}</span>
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
