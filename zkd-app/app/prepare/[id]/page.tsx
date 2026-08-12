'use client';

import Link from 'next/link';
import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useWorld } from '@/components/WorldProvider';
import { money } from '@/lib/time';
import SandboxNotice from '@/components/SandboxNotice';

export default function PreparePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const {
    world, chosen, setChosen, preAuth, setPreAuth, setPrepared, live,
    refreshAlts, refreshHotels, refreshForecast,
  } = useWorld();

  const [hotelId, setHotelId] = useState('h1');
  const [cabId, setCabId] = useState('c1');
  const [open, setOpen] = useState(false);

  // On-demand only, fires once per session — guarded at the provider level so
  // visiting /prepare and /recovery in the same session still only calls once total.
  useEffect(() => {
    if (!world) return;
    const f = world.upcoming.find((x) => x.id === id);
    if (!f?.watched || !f.bookedDepartureAt) return;
    const day = 24 * 60 * 60 * 1000;
    const dateISO = new Date(world.now.getTime() + 14 * day).toISOString().slice(0, 10);
    refreshAlts(f.from, f.to, dateISO, 'Economy');
    // The destination IATA goes to the server, which owns the airport directory.
    const checkout = new Date(world.now.getTime() + 15 * day).toISOString().slice(0, 10);
    refreshHotels(f.to, dateISO, checkout);
    refreshForecast(id, {
      flightIata: f.code.replace(/\s+/g, ''),
      from: f.from,
      to: f.to,
      date: new Date(f.bookedDepartureAt).toISOString().slice(0, 10),
      minutesToDeparture: Math.max(0, Math.round((f.bookedDepartureAt - world.now.getTime()) / 60_000)),
      hasHardConstraint: Boolean(f.hasHardConstraint),
    });
  }, [world, id]);

  if (!world) return <div className="page-h"><h1>Getting ahead of it</h1></div>;

  const f = world.upcoming.find((x) => x.id === id);
  if (!f?.watched) return <div className="page-h"><h1>Nothing to prepare</h1></div>;

  const liveAlts = live.alts.status === 'ok' ? live.alts.data?.alts ?? [] : [];
  const liveHotels = live.hotels.status === 'ok' ? live.hotels.data ?? [] : [];

  const forecast = live.forecast[id]?.data;
  const alt = [...world.alts, ...liveAlts].find((a) => a.id === chosen)!;
  const hotel = [...world.hotels, ...liveHotels].find((h) => h.id === hotelId)!;
  const cab = world.cabs.find((c) => c.id === cabId)!;
  // Mock hotels price via `extra` (over-entitlement amount, rate always 0); live
  // LiteAPI hotels price via `rate` (real market rate, extra always 0) — one of
  // the two is always the real cost for a given hotel.
  const hotelCost = hotel.extra || hotel.rate;
  const owed = alt.fare + hotelCost + cab.extra;

  const authorise = () => {
    setPreAuth({ flightId: id, altId: chosen, hotelId, cabId, owed, grantedAt: Date.now() });
    setPrepared(true);
    router.push('/flights');
  };

  const askLater = () => {
    setPreAuth(null);
    setPrepared(true);
    router.push('/flights');
  };

  return (
    <div className="skeleton">
      <Link href="/flights" className="back">← All flights</Link>

      <div className="page-h" style={{ padding: '0 0 26px' }}>
        <h1>{f.code} looks like it will cancel</h1>
        <p>
          The forecast puts it at{' '}
          <b style={{ color: 'var(--risk)' }}>{forecast ? `${forecast.pct}%` : '—'}</b>
          {forecast ? ` — over the ${forecast.thresholds.preAuthorise}% mark ` : ' — over the mark '}
          where we come and ask you early rather than in a hurry. It has <b>not</b> been cancelled.
          Nothing here is booked, and nothing is charged unless it actually is.
        </p>
      </div>
      <div className="split">
        <div>
          <div className="g panel" style={{ marginBottom: 16, borderColor: 'rgba(217,97,90,.3)' }}>
            <h3 style={{ color: 'var(--risk)' }}>Why we are asking now</h3>
            {forecast ? (
              <>
                <div className="kv">
                  <span className="k">Cancellation forecast</span>
                  <span className="v">{forecast.pct}%</span>
                </div>
                <div className="kv">
                  <span className="k">Where it comes from</span>
                  <span className="v">
                    {forecast.source === 'lumo' ? 'Lumo — live' : 'Lumo — mocked, no key yet'}
                  </span>
                </div>
                <div className="kv">
                  <span className="k">Ask-early threshold for this flight</span>
                  <span className="v">{forecast.thresholds.preAuthorise}%</span>
                </div>
                <div className="kv">
                  <span className="k">Seats left across every source</span>
                  <span className="v">{forecast.thresholds.inputs.seatsAvailable}</span>
                </div>
                <p style={{ margin: '12px 0 0', color: 'var(--mist)', fontSize: 12.5, lineHeight: 1.6 }}>
                  That threshold is not a fixed number. On a route with plenty of seats we wait for more
                  certainty; when there is little left to move you onto, asking early is worth more than
                  being sure.
                </p>
              </>
            ) : (
              <p style={{ margin: 0, color: 'var(--mist)', fontSize: 13.5 }}>
                Checking this flight against the disruption forecast.
              </p>
            )}
          </div>

          <div className="g panel">
            <h3>If it does cancel, here is the plan</h3>

            <div className="plan-grp">
              <div className="lbl">Flight</div>
              <div className="line-item">
                <span className="ic">✈</span>
                <span className="l">
                  <span className="t1">{alt.code} · {alt.dep}</span>
                  <span className="t2">arrives {alt.arr} · {alt.cabin} · protects your London leg</span>
                </span>
                <span className={`r ${alt.fare ? '' : 'free'}`}>
                  {alt.fare ? money(alt.fare) : 'no cost'}
                </span>
              </div>
            </div>

            <div className="plan-grp">
              <div className="lbl">Room tonight</div>
              <div className="line-item">
                <span className="ic">BED</span>
                <span className="l">
                  <span className="t1">{hotel.name}</span>
                  <span className="t2">{hotel.area} · check-in {hotel.checkin}</span>
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
                    <span className="t2">{cab.kind} · pickup {l.pickup}</span>
                  </span>
                  <span className={`r ${cab.extra ? '' : 'free'}`}>
                    {cab.extra ? money(cab.extra / 2) : 'airline pays'}
                  </span>
                </div>
              ))}
            </div>

            {!open && (
              <div className="acts" style={{ marginTop: 16 }}>
                <button onClick={() => setOpen(true)}>Change something</button>
              </div>
            )}

            {open && (
              <>
                <div className="lbl" style={{ marginTop: 20, marginBottom: 9 }}>Flights</div>
                <div className="opts">
                  {world.alts.map((a) => (
                    <button
                      key={a.id}
                      className={`opt ${a.ok ? '' : 'no'} ${a.id === chosen ? 'pick' : ''}`}
                      disabled={!a.ok}
                      onClick={() => setChosen(a.id)}
                    >
                      <span className="l">
                        <span className="fl">{a.code} · {a.dep}</span>
                        <span className="mt">{a.ok ? `arrives ${a.arr} · ${a.cabin}` : a.why}</span>
                      </span>
                      <span className="r">
                        <span className={`pr ${a.ok && !a.fare ? 'free' : ''}`}>
                          {a.ok ? (a.fare ? money(a.fare) : 'no cost to you') : 'not bookable'}
                        </span>
                      </span>
                    </button>
                  ))}
                  {liveAlts.length > 0 && (
                    <>
                      <SandboxNotice kind="flights" />
                      {liveAlts.map((a) => (
                        <button
                          key={a.id}
                          className={`opt ${a.ok ? '' : 'no'} ${a.id === chosen ? 'pick' : ''}`}
                          disabled={!a.ok}
                          onClick={() => setChosen(a.id)}
                        >
                          <span className="l">
                            <span className="fl">{a.code} · {a.dep}</span>
                            <span className="mt">{a.ok ? `arrives ${a.arr} · ${a.cabin}` : a.why}</span>
                          </span>
                          <span className="r">
                            <span className={`pr ${a.ok && !a.fare ? 'free' : ''}`}>
                              {a.ok ? (a.fare ? money(a.fare) : 'no cost to you') : 'not bookable'}
                            </span>
                          </span>
                        </button>
                      ))}
                    </>
                  )}
                </div>

                <div className="lbl" style={{ marginTop: 18, marginBottom: 9 }}>Room tonight</div>
                <div className="opts">
                  {world.hotels.map((h) => (
                    <button
                      key={h.id}
                      className={`opt ${h.ok ? '' : 'no'} ${h.id === hotelId ? 'pick' : ''}`}
                      disabled={!h.ok}
                      onClick={() => setHotelId(h.id)}
                    >
                      <span className="l">
                        <span className="fl">{h.name}</span>
                        <span className="mt">{h.ok ? `${h.area} · check-in ${h.checkin}` : h.why}</span>
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
                          className={`opt ${h.ok ? '' : 'no'} ${h.id === hotelId ? 'pick' : ''}`}
                          disabled={!h.ok}
                          onClick={() => setHotelId(h.id)}
                        >
                          <span className="l">
                            <span className="fl">{h.name}</span>
                            <span className="mt">{h.ok ? `${h.area} · check-in ${h.checkin}` : h.why}</span>
                          </span>
                          <span className="r">
                            <span className={`pr ${h.ok && !h.extra ? 'free' : ''}`}>
                              {h.ok ? (h.extra ? `${money(h.extra)} over` : money(h.rate)) : 'over the cap'}
                            </span>
                          </span>
                        </button>
                      ))}
                    </>
                  )}
                </div>

                <div className="lbl" style={{ marginTop: 18, marginBottom: 9 }}>Cab for both legs</div>
                <div className="opts">
                  {world.cabs.map((c) => (
                    <button
                      key={c.id}
                      className={`opt ${c.ok ? '' : 'no'} ${c.id === cabId ? 'pick' : ''}`}
                      disabled={!c.ok}
                      onClick={() => setCabId(c.id)}
                    >
                      <span className="l">
                        <span className="fl">{c.kind}</span>
                        <span className="mt">{c.ok ? `up to ${c.seats} seats · ${c.why}` : c.why}</span>
                      </span>
                      <span className="r">
                        <span className={`pr ${c.ok && !c.extra ? 'free' : ''}`}>
                          {c.ok ? (c.extra ? `${money(c.extra)} over` : 'airline pays') : 'over the cap'}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        <div>
          <div className="g panel" style={{ marginBottom: 16, borderColor: 'rgba(47,127,240,.34)' }}>
            <h3 style={{ color: 'var(--iris)' }}>What you are agreeing to</h3>
            <div className="kv">
              <span className="k">Charged if it cancels</span>
              <span className={`v ${owed ? 'warn' : 'ok'}`}>{owed ? money(owed) : 'nothing'}</span>
            </div>
            <div className="kv"><span className="k">Charged if it operates</span><span className="v ok">nothing</span></div>
            <div className="kv"><span className="k">Booked right now</span><span className="v ok">nothing</span></div>
            <div className="kv"><span className="k">If this plan is gone by then</span><span className="v">we ask you again</span></div>
            <p className="why">
              This is a conditional instruction, not a booking. It applies to this plan and this
              flight only. If the cancellation comes and these exact options are no longer available,
              the authorisation does not carry over — we come back to you rather than substituting
              something you never saw.
            </p>
          </div>

          <div className="g panel">
            <h3>Why we are asking now</h3>
            <p style={{ margin: '0 0 14px', color: 'var(--mist)', fontSize: 13.5, lineHeight: 1.6 }}>
              If you answer now, a cancellation needs no window at all — we already have your
              decision and act the second the airline files it. You get hours to think instead of a
              minute and a half, and we get to skip the only part of the recovery that has to wait for
              a human.
            </p>
            <button className="cta" onClick={authorise} style={{ width: '100%' }}>
              Yes — do this if it cancels
            </button>
            <button className="cta ghost" onClick={askLater} style={{ width: '100%' }}>
              Ask me at the time instead
            </button>
          </div>

          {preAuth && (
            <div className="g panel" style={{ marginTop: 16, borderColor: 'rgba(75,171,124,.34)' }}>
              <h3 style={{ color: 'var(--safe)' }}>Already authorised</h3>
              <p style={{ margin: 0, color: 'var(--mist)', fontSize: 13.5 }}>
                You have already told us what to do. Changing anything above and confirming again
                will replace that instruction.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
