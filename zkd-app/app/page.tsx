'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useWorld } from '@/components/WorldProvider';
import type { Consent } from '@/server/domain/types';

/**
 * Book a flight.
 *
 * The flights are REAL — OAG schedules for the route and date, via
 * /api/search/flights. What OAG does not sell is fares or seat inventory, so
 * no price is shown: inventing a plausible-looking number next to real flight
 * data is exactly the kind of thing that makes everything else look invented
 * too. The booking creates a real Flight + Booking + PNR and puts it straight
 * under the risk model.
 *
 * Two fields here exist for the concierge rather than the airline, and both
 * feed decisions made later, during a disruption:
 *
 *   - "I must arrive by" becomes Flight.hardDeadlineISO, which turns missing
 *     the deadline into a HARD RULE in rebooking (server/pipeline/score.ts)
 *     instead of a preference a weighted sum can outvote.
 *   - autopilot vs ask-me-first is the consent that decides whether we rebook
 *     on our own or wait for the member (server/engine/simulation.ts).
 */

type SearchFlight = {
  id: string;
  code: string;
  carrier: string;
  from: string;
  to: string;
  departureDate: string;
  departsLocal: string | null;
  arrivesLocal: string | null;
  departsUtc: string | null;
  durationMin: number | null;
  aircraft: string | null;
  terminal: string | null;
};

type SearchResponse = {
  from: string;
  to: string;
  date: string;
  fromCity: string | null;
  toCity: string | null;
  flights: SearchFlight[];
};

const todayPlus = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

export default function Home() {
  const router = useRouter();
  const { status } = useWorld();

  const [tripType, setTripType] = useState<'round' | 'oneway' | 'multi'>('oneway');
  const [cabinClass, setCabinClass] = useState('Economy');
  const [travelers, setTravelers] = useState('1 Traveler');
  const [from, setFrom] = useState('BOM - Mumbai');
  const [to, setTo] = useState('DEL - New Delhi');
  const [departDate, setDepartDate] = useState(todayPlus(7));
  const [returnDate, setReturnDate] = useState(todayPlus(12));

  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<SearchResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [selected, setSelected] = useState<SearchFlight | null>(null);
  const [deadline, setDeadline] = useState('');
  const [consent, setConsent] = useState<Consent>('ask');
  const [booking, setBooking] = useState(false);

  const swapAirports = () => {
    setFrom(to);
    setTo(from);
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    setSearching(true);
    setError(null);
    setResults(null);
    setSelected(null);
    try {
      const res = await fetch(
        `/api/search/flights?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&date=${departDate}`,
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `search failed (${res.status})`);
      setResults(json as SearchResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSearching(false);
    }
  };

  const confirmBooking = async () => {
    if (!selected) return;
    if (status !== 'authenticated') {
      router.push('/login');
      return;
    }
    setBooking(true);
    setError(null);
    try {
      const res = await fetch('/api/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: selected.code,
          from: selected.from,
          to: selected.to,
          depISO: selected.departsUtc,
          durationMin: selected.durationMin,
          aircraft: selected.aircraft ?? undefined,
          terminal: selected.terminal ?? undefined,
          cabin: cabinClass,
          // End of the chosen day, in the arrival airport's rough local terms.
          // Members think in days ("I must be there by Saturday"), not instants.
          hardDeadlineISO: deadline ? `${deadline}T23:59:00Z` : null,
          consent,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `booking failed (${res.status})`);
      router.push('/flights');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBooking(false);
    }
  };

  // OAG gives schedules, not offers — a flight with no published departure
  // instant cannot be booked into a system whose whole job is counting down to
  // it, so it is shown but not selectable.
  const bookable = (f: SearchFlight) => !!f.departsUtc && !!f.durationMin;

  return (
    <div className="amex-page">
      <div className="amex-container">
        <div className="amex-hero-wrap">
          <div className="amex-hero-card">
            <h1>Book a Flight for your next adventure!</h1>

            <div className="amex-service-tabs">
              <button type="button" className="amex-tab-pill active">✈ Flights</button>
              <button type="button" className="amex-tab-pill disabled" disabled>🏨 Hotels</button>
              <button type="button" className="amex-tab-pill disabled" disabled>🏡 Vacation Rentals</button>
              <button type="button" className="amex-tab-pill disabled" disabled>🚗 Cars</button>
              <button type="button" className="amex-tab-pill disabled" disabled>🚢 Cruises</button>
            </div>

            <form onSubmit={handleSearch}>
              <div className="amex-form-row">
                <div className="amex-seg">
                  {(['round', 'oneway', 'multi'] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      className={`amex-seg-btn ${tripType === t ? 'active' : ''}`}
                      onClick={() => setTripType(t)}
                    >
                      {t === 'round' ? 'Round Trip' : t === 'oneway' ? 'One Way' : 'Multi-City'}
                    </button>
                  ))}
                </div>

                <div style={{ display: 'flex', gap: 12 }}>
                  <div className="amex-field" style={{ width: 160 }}>
                    <select value={cabinClass} onChange={(e) => setCabinClass(e.target.value)}>
                      <option value="Economy">Economy</option>
                      <option value="Premium Economy">Premium Economy</option>
                      <option value="Business">Business</option>
                      <option value="First">First</option>
                    </select>
                  </div>
                  <div className="amex-field" style={{ width: 140 }}>
                    <select value={travelers} onChange={(e) => setTravelers(e.target.value)}>
                      <option value="1 Traveler">1 Traveler</option>
                      <option value="2 Travelers">2 Travelers</option>
                      <option value="3 Travelers">3 Travelers</option>
                      <option value="4+ Travelers">4+ Travelers</option>
                    </select>
                  </div>
                </div>
              </div>

              <div className="amex-field-group">
                <div className="amex-field">
                  <label>From</label>
                  <input type="text" value={from} onChange={(e) => setFrom(e.target.value)} placeholder="e.g. BOM" />
                </div>

                <button type="button" className="amex-swap-btn" onClick={swapAirports} title="Swap origin and destination">
                  ⇄
                </button>

                <div className="amex-field">
                  <label>To</label>
                  <input type="text" value={to} onChange={(e) => setTo(e.target.value)} placeholder="e.g. DEL" />
                </div>

                <div className="amex-field">
                  <label>Depart</label>
                  <input type="date" value={departDate} onChange={(e) => setDepartDate(e.target.value)} />
                </div>

                {tripType === 'round' && (
                  <div className="amex-field">
                    <label>Return</label>
                    <input type="date" value={returnDate} onChange={(e) => setReturnDate(e.target.value)} />
                  </div>
                )}

                <button type="submit" className="amex-btn-search" disabled={searching}>
                  {searching ? 'Searching…' : 'Search'}
                </button>
              </div>
            </form>
          </div>
        </div>

        {error && <div className="amex-notice amex-notice-bad">{error}</div>}

        {results && (
          <div className="amex-results">
            <h2>
              {results.flights.length} flight{results.flights.length === 1 ? '' : 's'}{' '}
              {results.fromCity ?? results.from} → {results.toCity ?? results.to}, {results.date}
            </h2>
            <p className="amex-results-note">
              Live schedules from OAG. Fares and seat maps aren&apos;t part of this feed, so nothing here
              is priced — every flight you book is monitored for cancellation risk from the moment
              it&apos;s confirmed.
            </p>

            {results.flights.length === 0 && (
              <div className="amex-notice">No scheduled flights on this route for that date.</div>
            )}

            <div className="amex-flight-list">
              {results.flights.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  className={`amex-flight-row ${selected?.id === f.id ? 'selected' : ''}`}
                  onClick={() => setSelected(f)}
                  disabled={!bookable(f)}
                >
                  <span className="amex-flight-code">{f.code}</span>
                  <span className="amex-flight-times">
                    {f.departsLocal ?? '—'} → {f.arrivesLocal ?? '—'}
                  </span>
                  <span className="amex-flight-meta">
                    {f.durationMin ? `${Math.floor(f.durationMin / 60)}h ${f.durationMin % 60}m` : 'duration n/a'}
                    {f.aircraft ? ` · ${f.aircraft}` : ''}
                    {f.terminal ? ` · T${f.terminal}` : ''}
                  </span>
                  <span className="amex-flight-pick">
                    {!bookable(f) ? 'No published time' : selected?.id === f.id ? 'Selected' : 'Select'}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {selected && (
          <div className="amex-booking">
            <h2>Confirm {selected.code}</h2>
            <p className="amex-results-note">
              {selected.from} → {selected.to}, {selected.departureDate}, departing{' '}
              {selected.departsLocal ?? '—'} · {cabinClass}
            </p>

            <div className="amex-booking-grid">
              <div className="amex-field">
                <label>Last day you must arrive by (optional)</label>
                <input
                  type="date"
                  value={deadline}
                  min={selected.departureDate}
                  onChange={(e) => setDeadline(e.target.value)}
                />
                <small>
                  If this flight is cancelled, we will not offer you anything that lands after this
                  date — it becomes a rule, not a preference.
                </small>
              </div>

              <div className="amex-field">
                <label>If this flight is disrupted</label>
                <div className="amex-consent">
                  <label className={consent === 'autopilot' ? 'active' : ''}>
                    <input
                      type="radio"
                      name="consent"
                      checked={consent === 'autopilot'}
                      onChange={() => setConsent('autopilot')}
                    />
                    <span>
                      <strong>Fix it and tell me after</strong>
                      We rebook you using the preferences on your card, then let you know.
                    </span>
                  </label>
                  <label className={consent === 'ask' ? 'active' : ''}>
                    <input
                      type="radio"
                      name="consent"
                      checked={consent === 'ask'}
                      onChange={() => setConsent('ask')}
                    />
                    <span>
                      <strong>Ask me first</strong>
                      We line up the options and wait for your go-ahead before booking anything.
                    </span>
                  </label>
                </div>
              </div>
            </div>

            {status !== 'authenticated' && (
              <div className="amex-notice">You&apos;ll need to sign in to confirm this booking.</div>
            )}

            <button type="button" className="amex-btn-search" onClick={confirmBooking} disabled={booking}>
              {booking ? 'Confirming…' : status === 'authenticated' ? 'Confirm booking' : 'Sign in to book'}
            </button>
          </div>
        )}

        <div className="amex-promos">
          <h2>For You &amp; Get Inspired</h2>
          <div className="amex-promo-grid">
            <div className="amex-promo-card">
              <div className="amex-promo-img">Taj Hotels &amp; Resorts</div>
              <div className="amex-promo-body">
                <h3>Earn 5x Points on Luxury Stays</h3>
                <p>Book curated domestic and international luxury hotel stays with your Centurion or Platinum Card.</p>
              </div>
            </div>
            <div className="amex-promo-card">
              <div className="amex-promo-img" style={{ background: 'linear-gradient(135deg, #006fcf, #10b981)' }}>
                Domestic Air travel
              </div>
              <div className="amex-promo-body">
                <h3>24/7 IRROPS Disruption Guard</h3>
                <p>ZKD Concierge automatically monitors your domestic flights for cancellation risk and rebooks seamlessly.</p>
              </div>
            </div>
            <div className="amex-promo-card">
              <div className="amex-promo-img" style={{ background: 'linear-gradient(135deg, #4f46e5, #00175a)' }}>
                Fine Hotels + Resorts
              </div>
              <div className="amex-promo-body">
                <h3>Complimentary Room Upgrades</h3>
                <p>Enjoy early check-in, late check-out, and $100 experience credits at participating luxury properties.</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
