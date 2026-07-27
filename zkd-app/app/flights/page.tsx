'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useWorld } from '@/components/WorldProvider';
import RouteLine from '@/components/Route';
import Pill from '@/components/Pill';
import HistoryTable from '@/components/HistoryTable';
import { risk, BAND_LABEL, BAND_SAY, GLOW } from '@/lib/risk';
import { PREAUTH_THRESHOLD } from '@/lib/recovery';
import { agoLabel } from '@/lib/time';

export default function FlightsPage() {
  const { world, disrupted, setDisrupted, consent, settled, chosen, preAuth, prepared } = useWorld();
  const [hovered, setHovered] = useState('u1');

  // The early ask has to come BEFORE the cancellation, or it is pointless.
  // Once the member has answered it, the cancellation follows shortly; if they
  // have not looked at it yet, hold off so the banner is readable.
  useEffect(() => {
    if (!world || disrupted) return;
    const t = setTimeout(() => setDisrupted(true), prepared ? 3500 : 22000);
    return () => clearTimeout(t);
  }, [world, disrupted, prepared, setDisrupted]);

  if (!world) return <div className="page-h"><h1>Your flights</h1></div>;

  const { upcoming, past, alts, detected } = world;
  const active = upcoming.find((f) => f.id === hovered) ?? upcoming[0];
  const gone = active.id === 'u1' && disrupted;
  const r = risk(active.signals!);
  const pick = alts.find((a) => a.id === chosen)!;
  const riskOfNext = risk(upcoming[0].signals!);

  return (
    <div className="skeleton">
      <div className="page-h">
        <h1>Your flights</h1>
        <p>
          We watch every booking and act the moment something breaks —{' '}
          {consent === 'autopilot' ? 'without waking you' : 'then wait for your go-ahead'}.{' '}
          <Link href="/settings" style={{ color: 'var(--iris)' }}>
            {consent === 'autopilot' ? 'Autopilot' : 'Ask me first'}
          </Link>{' '}
          is the permission you set when you activated your card.
        </p>
      </div>
      {/* Before anything breaks: if we are confident enough, ask early. This is
          the whole point — consent collected with hours to spare, not 90 seconds. */}
      {!disrupted && riskOfNext.pct >= PREAUTH_THRESHOLD && (
        <Link href={`/prepare/${upcoming[0].id}`} className="g alert warn" style={{ display: 'flex' }}>
          <span className="ic">!</span>
          <span className="tx">
            <span className="tt">
              {preAuth
                ? "You've told us what to do if AI 2803 cancels"
                : `AI 2803 looks like it will cancel — ${riskOfNext.pct}%`}
            </span>
            <span className="bd">
              {preAuth
                ? 'We act the second it happens. No 90-second window needed.'
                : "It hasn't been cancelled. Tell us now what you'd want, while you have time to think."}
            </span>
          </span>
          <span className="go">{preAuth ? 'Review →' : 'Decide now →'}</span>
        </Link>
      )}

      {disrupted && (
        <Link
          href="/recovery/u1"
          className={`g alert ${settled === 'booked' ? 'ok' : ''}`}
          style={{ display: 'flex' }}
        >
          <span className="ic">{settled === 'booked' ? '✓' : '!'}</span>
          <span className="tx">
            <span className="tt">
              {settled === 'booked'
                ? 'Rebooked. Your trip is back together.'
                : settled === 'handed-over'
                  ? 'A person has taken over your trip'
                  : 'AI 2803 has been cancelled'}
            </span>
            <span className="bd">
              {settled === 'booked'
                ? `${pick.code} at ${pick.dep} · hotel moved · you paid nothing`
                : settled === 'handed-over'
                  ? 'Nothing was booked and nothing was charged.'
                  : `Detected ${agoLabel(detected, world.now)}. ${
                      consent === 'autopilot'
                        ? "We're rebooking you now — tap to watch."
                        : 'We need your go-ahead before we book anything.'
                    }`}
            </span>
          </span>
          <span className="go">{settled === 'none' ? 'Open →' : 'View recovery →'}</span>
        </Link>
      )}

      <div className="sect">Upcoming</div>
      <div className="g up">
        <div className="up-list">
          {upcoming.map((f, i) => {
            const cancelled = f.id === 'u1' && disrupted;
            return (
              <Link
                key={f.id}
                href={cancelled ? '/recovery/u1' : `/flights/${f.id}`}
                className={`uprow ${f.id === hovered ? 'on' : ''}`}
                onMouseEnter={() => setHovered(f.id)}
                onFocus={() => setHovered(f.id)}
              >
                <div style={{ minWidth: 0 }}>
                  <div className="meta">
                    <span className="code">{f.code}</span>
                    {i === 0 && <span className="tag next">Next</span>}
                    {cancelled && (
                      <span className="tag" style={{ color: 'var(--risk)', borderColor: 'rgba(217,97,90,.4)' }}>
                        Cancelled
                      </span>
                    )}
                    <span className="when">{f.date}</span>
                  </div>
                  <RouteLine f={f} />
                </div>
              </Link>
            );
          })}
        </div>

        <div className="pred" style={{ ['--glow' as string]: gone ? GLOW.high : GLOW[r.band] }}>
          <div key={active.id + String(gone)} className="fade">
            <div className="eyebrow">{active.from} → {active.to}</div>
            {gone ? (
              <>
                <div className="n dead">✕</div>
                <div className="lb">Cancelled by the airline</div>
                <div className="say">
                  {settled === 'booked'
                    ? `We rebooked you on ${pick.code} at ${pick.dep} and moved tonight's hotel — you paid nothing.`
                    : 'We have alternatives ready and are waiting on the go-ahead.'}
                </div>
                <div className="go">View recovery →</div>
              </>
            ) : (
              <>
                <div className={`n ${r.band}`}>{r.pct}%</div>
                <div className="lb">chance of cancellation</div>
                <div className="say">{BAND_SAY[r.band]}</div>
                <div className="go">View details →</div>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="sect">Recent history</div>
      <HistoryTable rows={past.slice(0, 4)} />
      <p style={{ marginTop: 14 }}>
        <Link href="/history" className="back" style={{ margin: 0 }}>See all {past.length} flights →</Link>
      </p>
    </div>
  );
}
