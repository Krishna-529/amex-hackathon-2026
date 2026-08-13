'use client';

import Link from 'next/link';
import { useWorld } from '@/components/WorldProvider';
import { usePoll } from '@/lib/usePoll';
import { hhmm } from '@/lib/time';
import type { Passenger } from '@/server/domain/types';

export default function ProfilePage() {
  const { passengerId, schedule } = useWorld();
  const { data: passenger } = usePoll<Passenger>(passengerId ? `/api/passengers/${passengerId}` : null, 8000);
  if (!schedule || !passenger) return <div className="page-h"><h1>Your details</h1></div>;

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
            <div className="kv"><span className="k">Name, exactly as on your passport</span><span className="v">{passenger.legalName}</span></div>
            <div className="kv"><span className="k">Date of birth</span><span className="v">{passenger.dob}</span></div>
            <div className="kv"><span className="k">Gender</span><span className="v">{passenger.gender}</span></div>
            <div className="kv"><span className="k">Nationality</span><span className="v">{passenger.nationality}</span></div>
            <p className="why">
              Airlines match these three against your travel document at check-in. A mismatch is the most
              common reason an automatic rebooking is rejected, so we store them exactly as printed.
            </p>
          </div>

          <div className="g panel" style={{ marginBottom: 16 }}>
            <h3>Travel document</h3>
            <div className="kv"><span className="k">Passport</span><span className="v">{passenger.passport.number}</span></div>
            <div className="kv"><span className="k">Expires</span><span className="v">{passenger.passport.expiry}</span></div>
            <div className="kv"><span className="k">Issued by</span><span className="v">{passenger.passport.issued}</span></div>
            <p className="why">
              Needed for the international leg only. We show you the last two digits so you can confirm
              it is the right document without us displaying the number back to anyone.
            </p>
          </div>

          <div className="g panel" style={{ marginBottom: 16 }}>
            <h3>How the airline reaches you</h3>
            <div className="kv"><span className="k">Email</span><span className="v">{passenger.contact.email}</span></div>
            <div className="kv"><span className="k">Mobile</span><span className="v">{passenger.contact.phone}</span></div>
            <p className="why">
              These go on the booking itself. It is how the carrier sends your boarding pass — and how we
              reach you inside the window before we act.
            </p>
          </div>

          <div className="g panel">
            <h3>Frequent flyer</h3>
            {passenger.loyalty.map((l) => (
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
          <div className="g panel" style={{ marginBottom: 16 }}>
            <h3>Your bookings</h3>
            {schedule.upcoming.map((f) => (
              <div className="bk" key={f.id}>
                <div className="bk-h">
                  <span className="fc">{f.code}</span>
                  <span className="rt">{f.from} → {f.to}</span>
                  <span className="pnr">{f.booking?.pnr}</span>
                </div>
                <div className="bk-m">
                  {f.disruptionPhase !== 'none' ? (
                    <>Disrupted — <Link href={`/recovery/${f.id}`} style={{ color: 'var(--iris)' }}>view recovery</Link></>
                  ) : f.booking && f.booking.partySize > 1 ? (
                    <>{hhmm(new Date(f.depISO))} · {f.booking.partySize} travellers · {f.terminal}</>
                  ) : (
                    <>{hhmm(new Date(f.depISO))} · seat {f.booking?.seat} · {f.terminal}</>
                  )}
                </div>
              </div>
            ))}
          </div>

          {schedule.upcoming.some((f) => f.booking && f.booking.partySize > 1) && (
            <div className="g panel" style={{ marginBottom: 16 }}>
              <h3>Who travels with you</h3>
              {schedule.upcoming.filter((f) => f.booking && f.booking.partySize > 1).map((f) => (
                <div key={f.id} style={{ marginBottom: 10 }}>
                  <div className="kv"><span className="k">{f.code} · {f.from} → {f.to}</span><span className="v">{f.booking!.partySize} travellers</span></div>
                  {f.booking!.travellers.map((t) => (
                    <div className="kv" key={t.id}>
                      <span className="k">{t.displayName}{t.type !== 'adult' ? ` · ${t.type}` : ''}</span>
                      <span className="v">seat {t.seat}</span>
                    </div>
                  ))}
                </div>
              ))}
              <p className="why">
                Names and seats only. We never show a companion&apos;s passport or contact details here —
                the airline holds those, not us.
              </p>
            </div>
          )}

          <div className="g panel" style={{ marginBottom: 16 }}>
            <h3>How you like to fly</h3>
            {passenger.prefs.map((p) => (
              <div className="kv" key={p.k}><span className="k">{p.k}</span><span className="v">{p.v}</span></div>
            ))}
            <div className="kv">
              <span className="k">When a flight breaks</span>
              <span className="v"><Link href="/settings" style={{ color: 'var(--iris)' }}>
                {passenger.consent === 'autopilot' ? 'Autopilot' : 'Ask me first'}
              </Link></span>
            </div>
          </div>

          <div className="g panel" style={{ marginBottom: 16 }}>
            <h3>Payment</h3>
            <div className="kv"><span className="k">Card on file</span><span className="v">{passenger.payment.card}</span></div>
            <div className="kv"><span className="k">How we charge</span><span className="v">{passenger.payment.method}</span></div>
            <p className="why">
              Each booking gets its own single-use card number, locked to that amount and that date. It
              cannot be reused, so nothing here can be charged twice.
            </p>
          </div>

          <div className="g panel" style={{ borderColor: 'rgba(75,171,124,.3)' }}>
            <h3 style={{ color: 'var(--safe)' }}>What we never hold</h3>
            <div className="kv"><span className="k">We never store your CVV or full card number</span><span className="v ok">✓</span></div>
            <div className="kv"><span className="k">We never share your passport with anyone but the operating airline</span><span className="v ok">✓</span></div>
            <div className="kv"><span className="k">We never hold payment credentials the agent can reuse</span><span className="v ok">✓</span></div>
          </div>
        </div>
      </div>
    </div>
  );
}
