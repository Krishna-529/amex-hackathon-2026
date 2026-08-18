'use client';

import Link from 'next/link';
import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useWorld } from '@/components/WorldProvider';
import { usePoll } from '@/lib/usePoll';
import { money } from '@/lib/time';
import { roomsFor, vehiclesFor } from '@/lib/partyCost';
import type { FlightDetail, PreAuthResponse } from '@/lib/apiTypes';
import { PrepareSkeleton } from '@/components/PageSkeletons';

/**
 * What POST /api/flights/[id]/intent hands back. The route applies nothing —
 * this is a preview the member confirms or discards.
 */
type IntentResult = {
  understood: boolean;
  message?: string;
  restated?: string | null;
  confidence?: 'high' | 'medium' | 'low';
  diff?: {
    changes: string[];
    clamped: string[];
    unsupported: { asked: string; why: string }[];
  };
  removed?: { id: string; code: string; rule: string }[];
  options?: { id: string; code: string; dep: string; arr: string; partyFare: number; ok: boolean; why: string }[];
};

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

  // Free-text intent. `intent` is a PREVIEW: nothing it contains has been
  // applied to the member's profile or to any recovery until they press the
  // confirm button, which is what makes it safe to let a language model near
  // the input at all.
  const [text, setText] = useState('');
  const [thinking, setThinking] = useState(false);
  const [intent, setIntent] = useState<IntentResult | null>(null);

  const ask = () => {
    if (!text.trim() || thinking) return;
    setThinking(true);
    fetch(`/api/flights/${id}/intent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    })
      .then((r) => r.json())
      .then((r: IntentResult) => {
        setIntent(r);
        // Move their selection to the new top option, but only when we actually
        // understood them and something survived their own rules.
        if (r.understood && r.options?.length) {
          const best = r.options.find((o) => o.ok) ?? r.options[0];
          setAltId(best.id);
          setOpen(true);
        }
      })
      .catch(() =>
        setIntent({ understood: false, message: 'We could not reach that service. Your preferences are unchanged.' }),
      )
      .finally(() => setThinking(false));
  };

  const discardIntent = () => {
    setIntent(null);
    setText('');
  };

  useEffect(() => {
    if (!detail) return;
    setAltId((v) => v ?? detail.candidates.alts.find((a) => a.ok)?.id ?? detail.candidates.alts[0]?.id ?? null);
    setHotelId((v) => v ?? detail.candidates.hotels.find((h) => h.ok)?.id ?? detail.candidates.hotels[0]?.id ?? null);
    setCabId((v) => v ?? detail.candidates.cabs.find((c) => c.ok)?.id ?? detail.candidates.cabs[0]?.id ?? null);
  }, [detail]);

  if (!schedule || !detail) return <PrepareSkeleton />;

  const alt = detail.candidates.alts.find((a) => a.id === altId);
  const hotel = detail.candidates.hotels.find((h) => h.id === hotelId);
  const cab = detail.candidates.cabs.find((c) => c.id === cabId);
  // The selection effect above runs after the first render that has `detail`,
  // so there is one frame where the candidates exist but nothing is picked yet.
  if (!alt || !hotel || !cab) return <PrepareSkeleton />;

  const fc = detail.forecast;
  const partySize = detail.booking?.partySize ?? 1;
  const rooms = roomsFor(partySize);
  const vehicles = vehiclesFor(partySize, cab.seats);
  const hotelUnit = hotel.extra || hotel.rate;
  const hotelCost = hotelUnit * rooms;
  const cabCost = cab.extra * vehicles;
  const owed = alt.partyFare + hotelCost + cabCost;

  // What actually comes back, and therefore what this really costs. `refund`
  // is null when the viewer has no booking here, and `known: false` when we
  // have no record of the fare they paid — both render as "unknown" rather
  // than as zero, because a wrong refund becomes a wrong delta and the delta
  // is the number they decide on.
  const refund = detail.refund;
  const refundKnown = !!refund?.known;
  const refundTotal = refundKnown ? refund!.total : 0;
  const delta = owed - refundTotal;

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
          <b style={{ color: 'var(--risk)' }}>{fc ? `risk score ${Math.round(fc.riskScore ?? fc.pct)}/100` : '—'}</b>
          {fc
            ? ` — its real chance of cancellation, ${fc.pct}%, crossed the ${fc.thresholds.preAuthorise}% mark `
            : ' — over the mark '}
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
                <div className="kv"><span className="k">Risk score</span><span className="v">{Math.round(fc.riskScore ?? fc.pct)}/100</span></div>
                <div className="kv"><span className="k">Real calibrated probability</span><span className="v">{fc.pct}%</span></div>
                <div className="kv">
                  <span className="k">Where it comes from</span>
                  <span className="v">In-house model {fc.modelVersion} — live</span>
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

          <div className="g panel" style={{ marginBottom: 16 }}>
            <h3>Tell us what matters</h3>
            <p style={{ margin: '0 0 12px', color: 'var(--mist)', fontSize: 13.5, lineHeight: 1.6 }}>
              In your own words — a time you have to be there by, an airline you would rather not
              fly, how much of your own money you are willing to spend. We will re-order the
              options below and show you exactly what changed before anything is set.
            </p>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={600}
              rows={3}
              placeholder="e.g. I have to be in Delhi before 9pm for my sister's wedding, and I'd rather not fly Air India"
              style={{
                width: '100%', padding: '10px 12px', borderRadius: 8, resize: 'vertical',
                background: 'rgba(255,255,255,.03)', color: 'inherit', fontSize: 13.5,
                border: '1px solid rgba(255,255,255,.14)', fontFamily: 'inherit', lineHeight: 1.5,
              }}
            />
            <div className="acts" style={{ marginTop: 10 }}>
              <button onClick={ask} disabled={thinking || !text.trim()}>
                {thinking ? 'Reading that…' : 'Use this'}
              </button>
              {intent && <button onClick={discardIntent}>Undo</button>}
            </div>

            {intent && !intent.understood && (
              <p style={{ margin: '12px 0 0', color: 'var(--risk)', fontSize: 13.5, lineHeight: 1.6 }}>
                {intent.message}
              </p>
            )}

            {intent?.understood && (
              <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid rgba(255,255,255,.1)' }}>
                {intent.restated && (
                  <p style={{ margin: '0 0 10px', fontSize: 14, lineHeight: 1.6 }}>
                    <b>{intent.restated}</b>
                  </p>
                )}

                {!!intent.diff?.changes.length && (
                  <>
                    <div className="lbl" style={{ marginBottom: 6 }}>What we will do</div>
                    <ul style={{ margin: '0 0 12px', paddingLeft: 18, color: 'var(--mist)', fontSize: 13.5, lineHeight: 1.7 }}>
                      {intent.diff.changes.map((c) => <li key={c}>{c}</li>)}
                    </ul>
                  </>
                )}

                {/* Anything we altered from what was proposed is stated, never
                    silently corrected — a member who asked for something we
                    bent is owed the fact that we bent it. */}
                {!!intent.diff?.clamped.length && (
                  <>
                    <div className="lbl" style={{ marginBottom: 6 }}>What we adjusted</div>
                    <ul style={{ margin: '0 0 12px', paddingLeft: 18, color: 'var(--mist)', fontSize: 13.5, lineHeight: 1.7 }}>
                      {intent.diff.clamped.map((c) => <li key={c}>{c}</li>)}
                    </ul>
                  </>
                )}

                {!!intent.diff?.unsupported.length && (
                  <>
                    <div className="lbl" style={{ marginBottom: 6 }}>What we cannot do</div>
                    <ul style={{ margin: '0 0 12px', paddingLeft: 18, color: 'var(--risk)', fontSize: 13.5, lineHeight: 1.7 }}>
                      {intent.diff.unsupported.map((u) => (
                        <li key={u.asked}>{u.asked} — {u.why}</li>
                      ))}
                    </ul>
                  </>
                )}

                {/* "We found nothing" and "your own instruction excluded
                    everything" are different answers, and the member is owed
                    the second one. */}
                {!!intent.removed?.length && (
                  <>
                    <div className="lbl" style={{ marginBottom: 6 }}>Ruled out by what you told us</div>
                    <ul style={{ margin: '0 0 12px', paddingLeft: 18, color: 'var(--mist)', fontSize: 13.5, lineHeight: 1.7 }}>
                      {intent.removed.map((r) => <li key={r.id}>{r.code} — {r.rule}</li>)}
                    </ul>
                  </>
                )}

                {intent.options?.length === 0 && (
                  <p style={{ margin: 0, color: 'var(--risk)', fontSize: 13.5, lineHeight: 1.6 }}>
                    Nothing we can see meets all of that. Loosen one of the conditions above, or
                    press Undo and choose from the full list yourself.
                  </p>
                )}

                {intent.confidence === 'low' && (
                  <p style={{ margin: '4px 0 0', color: 'var(--mist)', fontSize: 12.5, lineHeight: 1.6 }}>
                    We were not very sure about this one — worth checking the list below before you
                    confirm.
                  </p>
                )}
              </div>
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
                        {/* Where a fare was converted, the supplier's own
                            number stays visible beside ours — the conversion
                            is honest only if the original is still there. */}
                        {a.quoted && (
                          <span className="mt" style={{ display: 'block', opacity: 0.7, fontSize: 11.5 }}>
                            {a.quoted.currency} {a.quoted.amount.toLocaleString('en-IN')} converted
                          </span>
                        )}
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

            {/* Three rows, not one. The price of the replacement is only half
                the story — the airline owes the original ticket back, and the
                number that actually matters is the difference. Showing only
                the first would overstate what this costs by the whole fare. */}
            <div className="kv">
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
                {!refundKnown
                  ? `${money(owed)} before any refund`
                  : delta > 0
                    ? money(delta)
                    : delta < 0
                      ? `${money(-delta)} back to you`
                      : 'nothing'}
              </span>
            </div>

            {refundKnown && !!refund?.lines.length && (
              <div style={{ margin: '10px 0 4px' }}>
                {refund.lines.map((l) => (
                  <div className="kv" key={l.label} style={{ opacity: 0.75, fontSize: 12.5 }}>
                    <span className="k">{l.label}</span>
                    <span className="v">{l.amount >= 0 ? money(l.amount) : `−${money(-l.amount)}`}</span>
                  </div>
                ))}
                {refund.statutory && (
                  <p className="why" style={{ marginTop: 6 }}>
                    {refund.lines[0]?.basis}
                  </p>
                )}
              </div>
            )}

            {!refundKnown && (
              <p className="why">
                We do not have a record of what you paid for this ticket, so we are not going to
                guess what comes back. The figure above is what the replacement costs before any
                refund is applied.
              </p>
            )}

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
