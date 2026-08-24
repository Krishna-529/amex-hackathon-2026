'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useWorld } from '@/components/WorldProvider';
import RouteLine from '@/components/Route';
import HistoryTable from '@/components/HistoryTable';
import { BAND_SAY, GLOW, BAND_LABEL, ACT_AT_RISK_SCORE, isActingOnRisk } from '@/lib/thresholds';
import { usePoll } from '@/lib/usePoll';
import { dayLabel } from '@/lib/time';
import type { PreAuthResponse } from '@/lib/apiTypes';
import { FlightsSkeleton } from '@/components/PageSkeletons';
import { AnimatedScore } from '@/components/AnimatedScore';

export default function FlightsPage() {
  const { passengerId, schedule } = useWorld();
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const upcoming = schedule?.upcoming ?? [];
  const past = schedule?.past ?? [];
  const stays = schedule?.stays ?? [];
  const next = upcoming[0];
  const activeId = hoveredId ?? next?.id;
  const active = upcoming.find((f) => f.id === activeId) ?? next;

  const nextDisrupted = !!next && next.disruptionPhase !== 'none';
  const activeDisrupted = !!active && active.disruptionPhase !== 'none';

  // On-demand polling only when there's actually something to watch — no
  // client-side disruption timer any more (that's operator-triggered now).
  // The passenger id no longer travels in the URL — every one of these is
  // scoped to the signed-in session on the server. Live recovery-phase
  // polling (RecoveryView, the rebooking-in-progress banner) is the
  // execution-plane's own concern, not this branch's — cancelled flights
  // still show here, just without a live phase readout.
  const { data: preAuth } = usePoll<PreAuthResponse>(
    next && !nextDisrupted && passengerId ? `/api/flights/${next.id}/preauth` : null, 5000,
  );

  // Two different states used to share one guard. `!schedule` is genuinely
  // loading, and gets the same skeleton app/flights/loading.tsx just showed —
  // so the handover from "route still loading" to "route loaded, data still
  // loading" is invisible. `schedule && !next` is a member with nothing
  // upcoming, which is a finished answer, so it gets a real empty state
  // further down; shimmering at them forever would be a lie.
  if (!schedule) return <FlightsSkeleton />;

  const consent = schedule.passenger.consent;

  if (!next) {
    return (
      <div className="amex-page">
        <div className="amex-container">
          <div className="skeleton">
            <div className="page-h">
              <h1>Your flights</h1>
              <p>
                Nothing upcoming. Book a flight and we start watching it for cancellation risk the
                moment it&apos;s confirmed — you don&apos;t have to turn anything on.
              </p>
            </div>
            <p>
              <Link href="/" className="back" style={{ margin: 0 }}>Book a flight →</Link>
            </p>
            {past.length > 0 && (
              <>
                <div className="sect">Recent history</div>
                <HistoryTable rows={past.slice(0, 4)} />
                <p style={{ marginTop: 14 }}>
                  <Link href="/history" className="back" style={{ margin: 0 }}>See all {past.length} flights →</Link>
                </p>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="amex-page">
      <div className="amex-container">
        <div className="skeleton">
          <div className="page-h">
            <h1>Your flights</h1>
            <p>
              We watch every booking and act the moment something breaks —{' '}
              {consent === 'autopilot' ? 'without waking you' : 'then wait for your go-ahead'}.{' '}
              <Link href="/settings" style={{ color: '#006fcf' }}>
                {consent === 'autopilot' ? 'Autopilot' : 'Ask me first'}
              </Link>{' '}
              is the permission you set when you activated your card.
            </p>
          </div>

          {/* Before anything breaks: if the forecast has crossed THIS flight's own
              ask-early threshold, ask. The threshold is not a fixed 80 — it moves with
              how many seats are left and how close departure is. */}
          {!nextDisrupted && next.forecast && next.forecast.pct >= next.forecast.thresholds.preAuthorise && (
            <Link href={`/flights/${next.id}`} className="g alert warn" style={{ display: 'flex' }}>
              <span className="ic">!</span>
              <span className="tx">
                <span className="tt">
                  {preAuth
                    ? `You've told us what to do if ${next.code} cancels`
                    : `${next.code} looks like it will cancel — risk score ${Math.round(next.forecast.riskScore ?? next.forecast.pct)}/100`}
                </span>
                <span className="bd">
                  {preAuth
                    ? 'We act the second it happens. No decision window needed at all.'
                    : "It hasn't been cancelled. Tell us now what you'd want, while you have time to think."}
                </span>
              </span>
              <span className="go">{preAuth ? 'Review →' : 'Decide now →'}</span>
            </Link>
          )}

          {nextDisrupted && (
            <Link href={`/recovery/${next.id}`} className="g alert" style={{ display: 'flex' }}>
              <span className="ic">!</span>
              <span className="tx">
                <span className="tt">{next.code} has been cancelled</span>
                <span className="bd">
                  {consent === 'autopilot'
                    ? "We're rebooking you now — tap to watch."
                    : 'We need your go-ahead before we book anything.'}
                </span>
              </span>
              <span className="go">Open →</span>
            </Link>
          )}

          <div className="sect">Upcoming</div>
          <div className="g up">
            <div className="up-list">
              {upcoming.map((f, i) => {
                const cancelled = f.disruptionPhase !== 'none';
                // Acting, not merely worrying: this is the score at which the
                // engine starts spending supplier calls to pre-fetch
                // alternatives. Highlighting anything else would draw the eye
                // to a number that changes nothing.
                const acting = !cancelled && isActingOnRisk(f.forecast?.riskScore);
                return (
                  <Link
                    key={f.id}
                    href={cancelled ? `/recovery/${f.id}` : `/flights/${f.id}`}
                    className={`uprow ${f.id === activeId ? 'on' : ''} ${acting ? 'acting' : ''}`}
                    onMouseEnter={() => setHoveredId(f.id)}
                    onFocus={() => setHoveredId(f.id)}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div className="meta">
                        <span className="code">{f.code}</span>
                        {i === 0 && <span className="tag next">Next</span>}
                        {f.booking && f.booking.partySize > 1 && (
                          <span className="tag">{f.booking.partySize} travellers</span>
                        )}
                        {cancelled && (
                          <span className="tag" style={{ color: 'var(--risk)', borderColor: 'rgba(217,97,90,.4)' }}>
                            Cancelled
                          </span>
                        )}
                        {f.replacesFlightCode && (
                          <span className="tag" title={`Rebooked to replace ${f.replacesFlightCode}`}>
                            Booked on behalf of {f.replacesFlightCode}
                          </span>
                        )}
                        {acting && (
                          <span className="tag acting-tag" title={`Risk score ${Math.round(f.forecast!.riskScore!)}/100 — at or above ${ACT_AT_RISK_SCORE}, where we start searching alternatives`}>
                            {Math.round(f.forecast!.riskScore!)}/100 · searching alternatives
                          </span>
                        )}
                        <span className="when">{dayLabel(new Date(f.depISO), new Date())}</span>
                      </div>
                      <RouteLine f={f} />
                      <div className="foot">
                        {cancelled ? (
                          <span style={{ color: 'var(--risk)' }}>Cancelled by the airline</span>
                        ) : f.forecast ? (
                          <>
                            <span className="risk-num">{Math.round(f.forecast.riskScore ?? f.forecast.pct)}/100</span>
                            <span>· {BAND_LABEL[f.forecast.band].toLowerCase()}</span>
                          </>
                        ) : (
                          <span>awaiting forecast</span>
                        )}
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>

            <div className="pred" style={{ ['--glow' as string]: activeDisrupted ? GLOW['hold-gate'] : GLOW[active?.forecast?.band ?? 'watch'] }}>
              <div key={String(active?.id) + String(activeDisrupted)} className="fade">
                <div className="eyebrow">{active?.from} → {active?.to}</div>
                {activeDisrupted ? (
                  <>
                    <div className="n dead">✕</div>
                    <div className="lb">Cancelled by the airline</div>
                    <div className="say">We have alternatives ready and are waiting on the go-ahead.</div>
                    {active && <Link className="go" href={`/recovery/${active.id}`} style={{ display: 'block' }}>View recovery →</Link>}
                  </>
                ) : (
                  <>
                    {/*
                      The bare number here read as a percentage — someone seeing
                      "45" reasonably asked whether it meant a 45% chance of
                      cancellation. It does not: riskScore is a 0-100 PERCENTILE
                      rank against the model's own live score distribution, and
                      that flight's actual cancel probability was 3%. Every
                      other screen already writes it "45/100"; this one did not,
                      which is exactly where the confusion came from. The band
                      label underneath says the same thing in words.
                    */}
                    <div className={`n ${active?.forecast?.tone ?? 'low'}`}>
                      <AnimatedScore value={active?.forecast ? Math.round(active.forecast.riskScore ?? active.forecast.pct) : null} />
                      {active?.forecast && <span className="n-den">/100</span>}
                    </div>
                    <div className="lb">
                      risk score{active?.forecast ? ` · ${BAND_LABEL[active.forecast.band].toLowerCase()}` : ''}
                    </div>
                    <div className="say">
                      {active?.forecast
                        ? BAND_SAY[active.forecast.band]
                        : 'Checking this flight against the disruption forecast.'}
                    </div>
                    {active && <Link className="go" href={`/flights/${active.id}`} style={{ display: 'block' }}>View details →</Link>}
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Hotels the member booked themselves. Shown here rather than on a
              separate page because this IS "my trips" — a stay that lives
              nowhere in the UI is a booking they have no reason to believe
              happened. Flights keep the prediction panel above; a stay has no
              cancellation model behind it, so it is presented as a plain
              record rather than dressed up as something we are watching. */}
          {stays.length > 0 && (
            <>
              <div className="sect">Your stays</div>
              <div className="g up" style={{ marginBottom: 8 }}>
                <div className="up-list" style={{ gridColumn: '1 / -1' }}>
                  {stays.map((s) => (
                    <div key={s.id} className="uprow" style={{ cursor: 'default' }}>
                      <div style={{ minWidth: 0 }}>
                        <div className="meta">
                          <span className="code">{s.reference}</span>
                          <span className="tag">{s.rooms} room{s.rooms === 1 ? '' : 's'}</span>
                          {s.refundable && <span className="tag">Free cancellation</span>}
                          <span className="when">{s.checkin} → {s.checkout}</span>
                        </div>
                        <div style={{ marginTop: 6, fontSize: 15, fontWeight: 600 }}>{s.name}</div>
                        <div style={{ fontSize: 13, color: 'var(--mist)' }}>
                          {s.area ? `${s.area} · ` : ''}{s.cityName}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                        {s.currency} {s.total.toLocaleString()}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          <div className="sect">Recent history</div>
          <HistoryTable rows={past.slice(0, 4)} />
          <p style={{ marginTop: 14 }}>
            <Link href="/history" className="back" style={{ margin: 0 }}>See all {past.length} flights →</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
