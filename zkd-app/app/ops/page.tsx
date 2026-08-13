'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { usePoll } from '@/lib/usePoll';
import { hhmm } from '@/lib/time';
import type { FlightSummary, DisruptionOpsView } from '@/lib/apiTypes';

type PassengerRow = { id: string; displayName: string; consent: string };

const emptyForm = {
  code: '', from: '', to: '', depISO: '', durationMin: 120,
  aircraft: '', terminal: '', passengerIds: [] as string[],
};

/**
 * Not part of the member experience (not linked from SiteHeader — direct-URL
 * only). Stands in for a real production live-feed poller: a demo can't wait
 * for an actual airline to cancel a flight, so "Trigger disruption" calls the
 * exact same detectDisruption() entry point a live AviationStack-status
 * watcher would call. Everything below is a passive view of the same backend
 * every member device polls — this page has no special access to state.
 */
export default function OpsPage() {
  const { data: flights } = usePoll<FlightSummary[]>('/api/flights', 3000);
  const { data: passengers } = usePoll<PassengerRow[]>('/api/passengers', 8000);
  const { data: disruptions } = usePoll<DisruptionOpsView[]>('/api/disruptions', 2000);

  const [form, setForm] = useState(emptyForm);
  const [busyId, setBusyId] = useState<string | null>(null);

  const trigger = (flightId: string) => {
    setBusyId(flightId);
    fetch('/api/disruptions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ flightId }),
    }).finally(() => setBusyId(null));
  };

  const togglePassenger = (id: string) => {
    setForm((f) => ({
      ...f,
      passengerIds: f.passengerIds.includes(id)
        ? f.passengerIds.filter((x) => x !== id)
        : [...f.passengerIds, id],
    }));
  };

  const addFlight = (e: FormEvent) => {
    e.preventDefault();
    if (!form.depISO) return;
    fetch('/api/flights', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, depISO: new Date(form.depISO).toISOString() }),
    }).then(() => setForm(emptyForm));
  };

  return (
    <div className="skeleton">
      <div className="page-h">
        <h1>Operator console</h1>
        <p>
          Not part of the member experience — stands in for a live status feed. A demo can&apos;t wait
          for a real airline to actually cancel a flight, so this triggers the same detection entry
          point a production poller would call. Everything below is a plain viewer of the shared backend
          state, same as any member device.
        </p>
      </div>

      <div className="sect">Flights</div>
      <div className="g" style={{ overflow: 'hidden', marginBottom: 28 }}>
        <table className="tbl">
          <thead>
            <tr>
              <th>Flight</th><th>Route</th><th>Departs</th><th>Risk</th><th>Passengers</th>
              <th>Status</th><th className="ar">Action</th>
            </tr>
          </thead>
          <tbody>
            {(flights ?? []).map((f) => (
              <tr key={f.id}>
                <td className="fc">{f.code}</td>
                <td className="rt">{f.from} → {f.to}</td>
                <td className="dt">{hhmm(new Date(f.depISO))}</td>
                <td>
                  {f.forecast ? `${f.forecast.pct}%` : '—'}{' '}
                  <span style={{ color: 'var(--mist2)' }}>
                    ({f.forecast ? `${f.forecast.band} · ${f.forecast.source}` : 'awaiting forecast'})
                  </span>
                </td>
                <td>{f.passengerCount}</td>
                <td>
                  {f.disruptionPhase === 'none' ? (
                    <span style={{ color: 'var(--mist2)' }}>watching</span>
                  ) : (
                    <span style={{ color: 'var(--risk)' }}>{f.disruptionPhase}</span>
                  )}
                </td>
                <td className="ar">
                  <button
                    disabled={f.disruptionPhase !== 'none' || busyId === f.id}
                    onClick={() => trigger(f.id)}
                  >
                    {f.disruptionPhase !== 'none' ? 'Triggered' : busyId === f.id ? 'Triggering…' : 'Trigger disruption'}
                  </button>
                </td>
              </tr>
            ))}
            {flights && flights.length === 0 && (
              <tr><td colSpan={7} style={{ color: 'var(--mist2)' }}>No flights yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="sect">Add a flight</div>
      <form onSubmit={addFlight} className="g panel ops-form" style={{ marginBottom: 28, display: 'grid', gap: 12 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
          <input required placeholder="Code, e.g. AI 999" value={form.code}
            onChange={(e) => setForm({ ...form, code: e.target.value })} />
          <input required placeholder="From, e.g. DEL" value={form.from}
            onChange={(e) => setForm({ ...form, from: e.target.value.toUpperCase() })} />
          <input required placeholder="To, e.g. BOM" value={form.to}
            onChange={(e) => setForm({ ...form, to: e.target.value.toUpperCase() })} />
          <input required type="datetime-local" value={form.depISO}
            onChange={(e) => setForm({ ...form, depISO: e.target.value })} />
          <input required type="number" min={30} placeholder="Duration (min)" value={form.durationMin}
            onChange={(e) => setForm({ ...form, durationMin: Number(e.target.value) })} />
          <input placeholder="Aircraft" value={form.aircraft}
            onChange={(e) => setForm({ ...form, aircraft: e.target.value })} />
          <input placeholder="Terminal" value={form.terminal}
            onChange={(e) => setForm({ ...form, terminal: e.target.value })} />
        </div>
        <div>
          <div className="lbl" style={{ marginBottom: 8 }}>Passengers on this flight</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {(passengers ?? []).map((p) => (
              <button
                type="button"
                key={p.id}
                onClick={() => togglePassenger(p.id)}
                className={`opt ${form.passengerIds.includes(p.id) ? 'pick' : ''}`}
                style={{ padding: '7px 14px', width: 'auto' }}
              >
                {p.displayName}
              </button>
            ))}
          </div>
        </div>
        <button className="go" type="submit" style={{ justifySelf: 'start', padding: '10px 20px' }}>
          Add flight
        </button>
      </form>

      <div className="sect">Active disruptions</div>
      {(disruptions ?? []).length === 0 ? (
        <p style={{ color: 'var(--mist2)', fontSize: 13.5 }}>Nothing triggered right now.</p>
      ) : (
        (disruptions ?? []).map((d) => (
          <div className="g panel" key={d.flightId} style={{ marginBottom: 14 }}>
            <h3>
              {d.flightCode}
              <span style={{ float: 'right', fontWeight: 400, color: 'var(--mist2)', fontSize: 12 }}>{d.phase}</span>
            </h3>
            <table className="tbl" style={{ marginTop: 8 }}>
              <thead>
                <tr><th>Passenger</th><th>Phase</th><th>Seconds left</th><th className="ar">Resolution</th></tr>
              </thead>
              <tbody>
                {d.tasks.map((t) => (
                  <tr key={t.passengerId}>
                    <td>{t.passengerName}</td>
                    <td>{t.phase}</td>
                    <td>{t.phase === 'waiting' ? t.secondsLeft : '—'}</td>
                    <td className="ar">
                      {t.resolution ? (
                        <Link href={`/recovery/${d.flightId}?as=${t.passengerId}`}>{t.resolution.kind} →</Link>
                      ) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))
      )}
    </div>
  );
}
