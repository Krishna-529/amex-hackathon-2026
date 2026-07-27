'use client';

import Link from 'next/link';
import { useWorld } from '@/components/WorldProvider';
import { PROFILE } from '@/lib/data';

export default function ProfilePage() {
  const { world, consent, settled, chosen } = useWorld();
  if (!world) return <div className="page-h"><h1>Your details</h1></div>;

  const pick = world.alts.find((a) => a.id === chosen)!;
  const rebooked = settled === 'booked';

  return (
    <div className="skeleton">
      <Link href="/flights" className="back">← All flights</Link>

      <div className="page-h" style={{ padding: '0 0 30px' }}>
        <h1>Your details</h1>
        <p>
          Everything we hold about you, and why we need it. An airline will not issue a ticket in your
          name without these, so this is the whole list — nothing is kept that a booking does not require.
        </p>
      </div>
      <div className="split">
        <div>
          <div className="g panel" style={{ marginBottom: 16 }}>
            <h3>Who the ticket is issued to</h3>
            <div className="kv"><span className="k">Name, exactly as on your passport</span><span className="v">{PROFILE.legalName}</span></div>
            <div className="kv"><span className="k">Date of birth</span><span className="v">{PROFILE.dob}</span></div>
            <div className="kv"><span className="k">Gender</span><span className="v">{PROFILE.gender}</span></div>
            <div className="kv"><span className="k">Nationality</span><span className="v">{PROFILE.nationality}</span></div>
            <p className="why">
              Airlines match these three against your travel document at check-in. A mismatch is the most
              common reason an automatic rebooking is rejected, so we store them exactly as printed.
            </p>
          </div>

          <div className="g panel" style={{ marginBottom: 16 }}>
            <h3>Travel document</h3>
            <div className="kv"><span className="k">Passport</span><span className="v">{PROFILE.passport.number}</span></div>
            <div className="kv"><span className="k">Expires</span><span className="v">{PROFILE.passport.expiry}</span></div>
            <div className="kv"><span className="k">Issued by</span><span className="v">{PROFILE.passport.issued}</span></div>
            <p className="why">
              Needed for the international leg only. We show you the last two digits so you can confirm
              it is the right document without us displaying the number back to anyone.
            </p>
          </div>

          <div className="g panel" style={{ marginBottom: 16 }}>
            <h3>How the airline reaches you</h3>
            <div className="kv"><span className="k">Email</span><span className="v">{PROFILE.contact.email}</span></div>
            <div className="kv"><span className="k">Mobile</span><span className="v">{PROFILE.contact.phone}</span></div>
            <p className="why">
              These go on the booking itself. It is how the carrier sends your boarding pass — and how we
              reach you inside the 90 seconds before we act.
            </p>
          </div>

          <div className="g panel">
            <h3>Frequent flyer</h3>
            {PROFILE.loyalty.map((l) => (
              <div className="kv" key={l.number}>
                <span className="k">{l.airline}</span>
                <span className="v">{l.number}{l.tier !== '—' ? ` · ${l.tier}` : ''}</span>
              </div>
            ))}
            <p className="why">
              Attached to every rebooking so a disruption never costs you status miles.
            </p>
          </div>
        </div>

        <div>
          {/* ── the bookings themselves, with PNRs ── */}
          <div className="g panel" style={{ marginBottom: 16 }}>
            <h3>Your bookings</h3>
            {world.upcoming.map((f) => {
              const wasCancelled = f.id === 'u1';
              return (
                <div className="bk" key={f.id}>
                  <div className="bk-h">
                    <span className="fc">{f.code}</span>
                    <span className="rt">{f.from} → {f.to}</span>
                    <span className="pnr">{wasCancelled && rebooked ? 'RB4T9Z' : f.pnr}</span>
                  </div>
                  <div className="bk-m">
                    {wasCancelled && rebooked ? (
                      <>Reissued as <b>{pick.code} · {pick.dep}</b> — new record locator, old one voided</>
                    ) : (
                      <>{f.date} · {f.dep} · seat {f.seat} · {f.terminal}</>
                    )}
                  </div>
                </div>
              );
            })}
            <div className="bk">
              <div className="bk-h">
                <span className="fc">HOTEL</span>
                <span className="rt">{world.hotels[0].name}</span>
                <span className="pnr">HT-88214</span>
              </div>
              <div className="bk-m">
                {rebooked ? 'Check-in moved to 16:30 · same rate' : `Check-in ${world.hotels[0].checkin} · 1 night`}
              </div>
            </div>
            {world.cabLegs.map((l, i) => (
              <div className="bk" key={l.id}>
                <div className="bk-h">
                  <span className="fc">CAB</span>
                  <span className="rt">{l.from} → {l.to}</span>
                  <span className="pnr">{i === 0 ? 'CB-4471' : 'CB-4472'}</span>
                </div>
                <div className="bk-m">{world.cabs[0].kind} · pickup {l.pickup}</div>
              </div>
            ))}
          </div>

          <div className="g panel" style={{ marginBottom: 16 }}>
            <h3>How you like to fly</h3>
            {PROFILE.prefs.map((p) => (
              <div className="kv" key={p.k}><span className="k">{p.k}</span><span className="v">{p.v}</span></div>
            ))}
            <div className="kv">
              <span className="k">When a flight breaks</span>
              <span className="v"><Link href="/settings" style={{ color: 'var(--iris)' }}>
                {consent === 'autopilot' ? 'Autopilot' : 'Ask me first'}
              </Link></span>
            </div>
          </div>

          <div className="g panel" style={{ marginBottom: 16 }}>
            <h3>Payment</h3>
            <div className="kv"><span className="k">Card on file</span><span className="v">{PROFILE.payment.card}</span></div>
            <div className="kv"><span className="k">How we charge</span><span className="v">{PROFILE.payment.method}</span></div>
            <p className="why">
              Each booking gets its own single-use card number, locked to that amount and that date. It
              cannot be reused, so nothing here can be charged twice.
            </p>
          </div>

          <div className="g panel" style={{ borderColor: 'rgba(75,171,124,.3)' }}>
            <h3 style={{ color: 'var(--safe)' }}>What we never hold</h3>
            {PROFILE.never.map((n) => (
              <div className="kv" key={n}><span className="k">{n}</span><span className="v ok">✓</span></div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
