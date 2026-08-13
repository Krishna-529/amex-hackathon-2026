'use client';

import Link from 'next/link';
import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useWorld } from '@/components/WorldProvider';
import { usePoll } from '@/lib/usePoll';
import { money } from '@/lib/time';
import { roomsFor, vehiclesFor } from '@/lib/partyCost';
import type { FlightDetail, PreAuthResponse } from '@/lib/apiTypes';

export default function PreparePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { passengerId, schedule } = useWorld();

  const { data: detail } = usePoll<FlightDetail>(passengerId ? `/api/flights/${id}` : null, 5000);
  // The passenger id no longer needs to travel in the URL — the session on
  // this request IS the passenger, on both this GET and the preauth POST below.
  const { data: preAuth } = usePoll<PreAuthResponse>(passengerId ? `/api/flights/${id}/preauth` : null, 8000);

  const [altId, setAltId] = useState<string | null>(null);
  const [hotelId, setHotelId] = useState<string | null>(null);
  const [cabId, setCabId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!detail) return;
    setAltId((v) => v ?? detail.candidates.alts.find((a) => a.ok)?.id ?? detail.candidates.alts[0]?.id ?? null);
    setHotelId((v) => v ?? detail.candidates.hotels.find((h) => h.ok)?.id ?? detail.candidates.hotels[0]?.id ?? null);
    setCabId((v) => v ?? detail.candidates.cabs.find((c) => c.ok)?.id ?? detail.candidates.cabs[0]?.id ?? null);
  }, [detail]);

  if (!schedule || !detail) return <div className="page-h"><h1>Getting ahead of it</h1></div>;

  const alt = detail.candidates.alts.find((a) => a.id === altId);
  const hotel = detail.candidates.hotels.find((h) => h.id === hotelId);
  const cab = detail.candidates.cabs.find((c) => c.id === cabId);
  if (!alt || !hotel || !cab) return <div className="page-h"><h1>Getting ahead of it</h1></div>;

  const fc = detail.forecast;
  const partySize = detail.booking?.partySize ?? 1;
  const rooms = roomsFor(partySize);
  const vehicles = vehiclesFor(partySize, cab.seats);
  const hotelUnit = hotel.extra || hotel.rate;
  const hotelCost = hotelUnit * rooms;
  const cabCost = cab.extra * vehicles;
  const owed = alt.partyFare + hotelCost + cabCost;

  const authorise = () => {
    // passengerId is not sent — the server reads it from the session, the
    // same way the recovery engine does.
    fetch(`/api/flights/${id}/preauth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ altId, hotelId, cabId }),
    }).then(() => router.push('/flights'));
  };

  const askLater = () => router.push('/flights');

  return (
    <div className="skeleton">
      <Link href="/flights" className="back">← All flights</Link>

      <div className="page-h" style={{ padding: '0 0 26px' }}>
        <h1>{detail.code} looks like it will cancel</h1>
        <p>
          The forecast puts it at{' '}
          <b style={{ color: 'var(--risk)' }}>{fc ? `${fc.pct}%` : '—'}</b>
          {fc ? ` — over the ${fc.thresholds.preAuthorise}% mark ` : ' — over the mark '}
          where we come and ask you early rather than in a hurry. It has <b>not</b> been cancelled.
          Nothing here is booked, and nothing is charged unless it actually is.
        </p>
      </div>
      <div className="split">
        <div>
          <div className="g panel" style={{ marginBottom: 16, borderColor: 'rgba(217,97,90,.3)' }}>
            <h3 style={{ color: 'var(--risk)' }}>Why we are asking now</h3>
            {fc ? (
              <>
                <div className="kv"><span className="k">Cancellation forecast</span><span className="v">{fc.pct}%</span></div>
                <div className="kv">
                  <span className="k">Where it comes from</span>
                  <span className="v">{fc.source === 'lumo' ? 'Lumo — live' : 'Lumo — mocked, no key yet'}</span>
                </div>
                <div className="kv">
                  <span className="k">Ask-early threshold for this flight</span>
                  <span className="v">{fc.thresholds.preAuthorise}%</span>
                </div>
                <div className="kv">
                  <span className="k">Seats left across every source</span>
                  <span className="v">{fc.thresholds.inputs.seatsAvailable}</span>
                </div>
                <p className="why">
                  That threshold is not a fixed number. On a route with plenty of seats we wait for
                  more certainty; when there is little left to move you onto, asking early is worth
                  more than being sure.
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

            {partySize > 1 && (
              <div className="kv" style={{ marginBottom: 4 }}>
                <span className="k">Party</span>
                <span className="v">{partySize} travellers · {rooms} room{rooms === 1 ? '' : 's'} · {vehicles} cab{vehicles === 1 ? '' : 's'}</span>
              </div>
            )}

            <div className="plan-grp">
              <div className="lbl">Flight</div>
              <div className="line-item">
                <span className="ic">✈</span>
                <span className="l">
                  <span className="t1">{alt.code} · {alt.dep}</span>
                  <span className="t2">
                    arrives {alt.arr} · {alt.cabin}
                    {partySize > 1 && ` · ${partySize} seats`}
                    {alt.kind === 'carrier-protected' && ' · owed by the airline'}
                  </span>
                </span>
                <span className={`r ${alt.partyFare ? '' : 'free'}`}>
                  {alt.partyFare ? money(alt.partyFare) : 'no cost'}
                </span>
              </div>
            </div>

            <div className="plan-grp">
              <div className="lbl">Room{rooms > 1 ? 's' : ''} tonight</div>
              <div className="line-item">
                <span className="ic">BED</span>
                <span className="l">
                  <span className="t1">{hotel.name}</span>
                  <span className="t2">{hotel.area} · check-in {hotel.checkin}{rooms > 1 && ` · ${rooms} rooms`}</span>
                </span>
                <span className={`r ${hotelCost ? '' : 'free'}`}>
                  {hotelCost ? money(hotelCost) : 'airline pays'}
                </span>
              </div>
            </div>

            <div className="plan-grp">
              <div className="lbl">{vehicles > 1 ? `${vehicles} × ${cab.kind}` : `Cab · ${cab.kind}`}</div>
              {detail.candidates.cabLegs.map((l) => (
                <div className="line-item" key={l.id}>
                  <span className="ic">CAB</span>
                  <span className="l">
                    <span className="t1">{l.from} → {l.to}</span>
                    <span className="t2">{cab.kind} · pickup {l.pickup}</span>
                  </span>
                  <span className={`r ${cabCost ? '' : 'free'}`}>
                    {cabCost ? money(cabCost / 2) : 'airline pays'}
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
                  {detail.candidates.alts.map((a) => (
                    <button
                      key={a.id}
                      className={`opt ${a.ok ? '' : 'no'} ${a.id === altId ? 'pick' : ''}`}
                      disabled={!a.ok}
                      onClick={() => setAltId(a.id)}
                    >
                      <span className="l">
                        <span className="fl">{a.code} · {a.dep}</span>
                        <span className="mt">{a.ok ? `arrives ${a.arr} · ${a.cabin}` : a.why}</span>
                      </span>
                      <span className="r">
                        <span className={`pr ${a.ok && !a.partyFare ? 'free' : ''}`}>
                          {a.ok ? (a.partyFare ? money(a.partyFare) : 'no cost to you') : 'not bookable'}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>

                <div className="lbl" style={{ marginTop: 18, marginBottom: 9 }}>Room tonight</div>
                <div className="opts">
                  {detail.candidates.hotels.map((h) => (
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
                </div>

                <div className="lbl" style={{ marginTop: 18, marginBottom: 9 }}>Cab for both legs</div>
                <div className="opts">
                  {detail.candidates.cabs.map((c) => (
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
              If you answer now, a cancellation needs no decision window at all — we already have your
              decision and act the second the airline files it. You get hours to think instead of the
              few minutes a live fare guarantee would give you, and we get to skip the only part of
              the recovery that has to wait for a human.
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
