'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useWorld } from '@/components/WorldProvider';
import type { Consent } from '@/server/domain/types';
import { SkLine, SkText } from '@/components/Skeletons';

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
  arrivalDate: string;
  departsLocal: string | null;
  arrivesLocal: string | null;
  /** local calendar days between departure and arrival: +1 on most eastbound
   *  long-haul, -1 across the dateline, 0 on a same-day hop */
  arrivesDayOffset: number;
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

/**
 * Dates default to empty and are filled on the CLIENT after mount.
 *
 * Reading the clock during render would be a hydration bug: the server renders
 * one date into the HTML, the client computes another (a different tick, a
 * different timezone, or midnight passing between the two), React finds a
 * mismatch and throws the whole tree away. lib/time.ts's header calls this out
 * explicitly — "nothing reads the clock at module scope, because that would
 * differ between the server render and the client render and blow up
 * hydration" — and this file was violating it.
 */
const todayPlus = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

export default function Home() {
  const router = useRouter();
  const { status } = useWorld();

  const [tripType, setTripType] = useState<'round' | 'oneway' | 'multi'>('oneway');
  const [cabinClass, setCabinClass] = useState('Economy');
  const [travelers, setTravelers] = useState('1 Traveler');
  const [from, setFrom] = useState('BOM - Mumbai');
  const [to, setTo] = useState('DEL - New Delhi');
  const [departDate, setDepartDate] = useState('');
  const [returnDate, setReturnDate] = useState('');

  // Client-only, after hydration has already matched on the empty value.
  useEffect(() => {
    setDepartDate((d) => d || todayPlus(7));
    setReturnDate((d) => d || todayPlus(12));
  }, []);

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
          // Sent as a plain calendar day. The server resolves it to the end of
          // that day in the DESTINATION's timezone — the browser can't, since
          // it knows neither the arrival airport's zone nor that its own zone
          // is the wrong one to use. See server/deadline.ts.
          hardDeadlineDate: deadline || null,
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

        {/* The search clears `results` before it fetches, so without this the
            page simply drops back to the promos and then jumps a card's worth
            of height when the schedules land. */}
        {searching && (
          <div className="amex-results" role="status" aria-busy="true" aria-live="polite">
            <span className="sk-sr">Searching for flights</span>
            <div aria-hidden="true">
              <h2><SkLine w="24ch" h=".8em" /></h2>
              <p className="amex-results-note"><SkText lines={2} last="52%" /></p>
              <div className="amex-flight-list">
                {[0, 1, 2, 3, 4].map((i) => (
                  <div className="amex-flight-row" key={i} style={{ pointerEvents: 'none' }}>
                    <span className="amex-flight-code"><SkLine w="5em" /></span>
                    <span className="amex-flight-times"><SkLine w="9em" /></span>
                    <span className="amex-flight-meta"><SkLine w={i % 2 ? '12em' : '15em'} /></span>
                    <span className="amex-flight-pick"><SkLine w="4em" /></span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

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
                    {f.arrivesDayOffset ? (
                      <sup title={`Arrives ${f.arrivalDate} local time`}>
                        {f.arrivesDayOffset > 0 ? `+${f.arrivesDayOffset}` : f.arrivesDayOffset}
                      </sup>
                    ) : null}
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
              {selected.departsLocal ?? '—'}
              {selected.arrivesDayOffset
                ? `, arriving ${selected.arrivesLocal ?? '—'} on ${selected.arrivalDate}`
                : ''}{' '}
              · {cabinClass}
            </p>

            <div className="amex-booking-grid">
              <div className="amex-field">
                <label>Last day you must arrive by (optional)</label>
                <input
                  type="date"
                  value={deadline}
                  // The ARRIVAL date, not the departure one: a long-haul that
                  // lands the next morning cannot satisfy a deadline set for
                  // the day it took off, and offering that day would only earn
                  // the server's "before this flight even arrives" rejection.
                  min={selected.arrivalDate || selected.departureDate}
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
                Air travel, worldwide
              </div>
              <div className="amex-promo-body">
                <h3>24/7 IRROPS Disruption Guard</h3>
                <p>ZKD Concierge automatically monitors your flights — domestic and international — for cancellation risk and rebooks seamlessly.</p>
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
