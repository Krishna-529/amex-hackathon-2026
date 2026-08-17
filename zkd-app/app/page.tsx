'use client';

import { useState } from 'react';

export default function Home() {
  const [tripType, setTripType] = useState<'round' | 'oneway' | 'multi'>('round');
  const [cabinClass, setCabinClass] = useState('Economy');
  const [travelers, setTravelers] = useState('1 Traveler');
  const [from, setFrom] = useState('DEL - New Delhi');
  const [to, setTo] = useState('BOM - Mumbai');
  const [departDate, setDepartDate] = useState('2026-08-20');
  const [returnDate, setReturnDate] = useState('2026-08-25');

  const swapAirports = () => {
    setFrom(to);
    setTo(from);
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
  };

  return (
    <div className="amex-page">
      <div className="amex-container">
        <div className="amex-hero-wrap">
          <div className="amex-hero-card">
            <h1>Book a Flight for your next adventure!</h1>

            {/* Service Tabs */}
            <div className="amex-service-tabs">
              <button type="button" className="amex-tab-pill active">
                ✈ Flights
              </button>
              <button type="button" className="amex-tab-pill disabled" disabled>
                🏨 Hotels
              </button>
              <button type="button" className="amex-tab-pill disabled" disabled>
                🏡 Vacation Rentals
              </button>
              <button type="button" className="amex-tab-pill disabled" disabled>
                🚗 Cars
              </button>
              <button type="button" className="amex-tab-pill disabled" disabled>
                🚢 Cruises
              </button>
            </div>

            {/* Search Form */}
            <form onSubmit={handleSearch}>
              <div className="amex-form-row">
                <div className="amex-seg">
                  <button
                    type="button"
                    className={`amex-seg-btn ${tripType === 'round' ? 'active' : ''}`}
                    onClick={() => setTripType('round')}
                  >
                    Round Trip
                  </button>
                  <button
                    type="button"
                    className={`amex-seg-btn ${tripType === 'oneway' ? 'active' : ''}`}
                    onClick={() => setTripType('oneway')}
                  >
                    One Way
                  </button>
                  <button
                    type="button"
                    className={`amex-seg-btn ${tripType === 'multi' ? 'active' : ''}`}
                    onClick={() => setTripType('multi')}
                  >
                    Multi-City
                  </button>
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
                  <input
                    type="text"
                    value={from}
                    onChange={(e) => setFrom(e.target.value)}
                    placeholder="Departure airport or city"
                  />
                </div>

                <button type="button" className="amex-swap-btn" onClick={swapAirports} title="Swap origin and destination">
                  ⇄
                </button>

                <div className="amex-field">
                  <label>To</label>
                  <input
                    type="text"
                    value={to}
                    onChange={(e) => setTo(e.target.value)}
                    placeholder="Arrival airport or city"
                  />
                </div>

                <div className="amex-field">
                  <label>Depart</label>
                  <input
                    type="date"
                    value={departDate}
                    onChange={(e) => setDepartDate(e.target.value)}
                  />
                </div>

                {tripType === 'round' && (
                  <div className="amex-field">
                    <label>Return</label>
                    <input
                      type="date"
                      value={returnDate}
                      onChange={(e) => setReturnDate(e.target.value)}
                    />
                  </div>
                )}

                <button type="submit" className="amex-btn-search">
                  Search
                </button>
              </div>
            </form>
          </div>
        </div>

        {/* Promo Section */}
        <div className="amex-promos">
          <h2>For You & Get Inspired</h2>
          <div className="amex-promo-grid">
            <div className="amex-promo-card">
              <div className="amex-promo-img">
                Taj Hotels & Resorts
              </div>
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
