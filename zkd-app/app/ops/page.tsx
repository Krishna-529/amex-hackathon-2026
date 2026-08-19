'use client';

import { useState } from 'react';
import { usePoll } from '@/lib/usePoll';
import { hhmm, money } from '@/lib/time';
import type { FlightSummary, DisruptionOpsView } from '@/lib/apiTypes';
import { SkTableRows, SkLine } from '@/components/Skeletons';

/**
 * Only the detection slice of /api/pipeline/health is typed here — the budget
 * and cadence sections are rendered elsewhere and typing them again would give
 * this file a second opinion about a shape it does not own.
 */
type HealthResponse = {
  detection: {
    primaryLane: 'webhook' | 'poller' | 'manual';
    webhooks: {
      registered: boolean;
      reason: string | null;
      subscriptions: number;
      primary: boolean;
      providers: {
        provider: string;
        configured: boolean;
        lastDeliveryAt: number | null;
        deliveries: number;
        matched: number;
        stale: boolean;
      }[];
    };
    poller: {
      running: boolean;
      callsThisMonth: number;
      ceiling: number;
      budgetRemaining: boolean;
      role: 'primary' | 'standby';
    };
  };
};

const LANE_LABEL: Record<'webhook' | 'poller' | 'manual', string> = {
  webhook: 'Push feed — a carrier tells us within seconds',
  poller: 'Polling — up to five minutes behind, and budget-capped',
  manual: 'Manual only — nothing is watching automatically',
};

function ago(at: number | null): string {
  if (at === null) return 'never';
  const mins = Math.round((Date.now() - at) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  return `${Math.round(mins / 60)} h ago`;
}



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
  const { data: disruptions } = usePoll<DisruptionOpsView[]>('/api/disruptions', 2000);
  const { data: health } = usePoll<HealthResponse>('/api/pipeline/health', 10000);

  const [busyId, setBusyId] = useState<string | null>(null);
  const [warmingId, setWarmingId] = useState<string | null>(null);

  const trigger = (flightId: string) => {
    setBusyId(flightId);
    fetch('/api/disruptions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ flightId }),
    }).finally(() => setBusyId(null));
  };

  /**
   * Real candidates come from a real supplier search, gated on the real risk
   * model crossing its prefetch threshold (server/engine/forecast.ts) — the
   * point of that gate, not a bug. This bypasses it on demand: same real
   * search, just without waiting for the scorer, useful whenever a demo (or
   * an operator) wants a flight's alt/hotel/cab candidates warm right now.
   */
  const warm = (flightId: string) => {
    setWarmingId(flightId);
    fetch(`/api/flights/${flightId}/warm`, { method: 'POST' }).finally(() => setWarmingId(null));
  };

  return (
    <div className="skeleton">
      <div className="page-h">
        <h1>Operator console</h1>
        <p>
          Not part of the member experience — stands in for a live status feed. A demo can&apos;t wait
          for a real airline to actually cancel a flight, so this triggers the same detection entry
          point a production poller would call. This console has no account of its own and no way to
          view or act as a member — everything below is state, not a member&apos;s screen.
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
                  {f.forecast ? `${Math.round(f.forecast.riskScore ?? f.forecast.pct)}/100` : '—'}{' '}
                  <span style={{ color: 'var(--mist2)' }}>
                    ({f.forecast ? `${f.forecast.pct}% real · ${f.forecast.band} · ${f.forecast.source}` : 'awaiting forecast'})
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
                    disabled={warmingId === f.id}
                    onClick={() => warm(f.id)}
                    style={{ marginRight: 8 }}
                    title="Real supplier search, right now — bypasses the risk-score prefetch gate"
                  >
                    {warmingId === f.id ? 'Warming…' : 'Warm candidates'}
                  </button>
                  <button
                    disabled={f.disruptionPhase !== 'none' || busyId === f.id}
                    onClick={() => trigger(f.id)}
                  >
                    {f.disruptionPhase !== 'none' ? 'Triggered' : busyId === f.id ? 'Triggering…' : 'Trigger disruption'}
                  </button>
                </td>
              </tr>
            ))}
            {/* undefined is "still fetching", [] is "there are none" — the two
                had the same (empty) rendering before, which read as an answer. */}
            {!flights && <SkTableRows cols={7} rows={4} />}
            {flights && flights.length === 0 && (
              <tr><td colSpan={7} style={{ color: 'var(--mist2)' }}>No flights yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ── How would we find out? ──────────────────────────────────────────
          The most important panel on this page, and the reason it exists: a
          webhook feed that has stopped delivering looks exactly like a week
          with no cancellations. Both are silence. If an operator cannot read
          which lane is live, the first sign of a dead subscription is a
          stranded member. */}
      <div className="sect">Detection</div>
      <div className="g panel" style={{ marginBottom: 28 }}>
        {!health && <SkLine />}
        {health && (
          <>
            <div className="kv">
              <span className="k">How we would find out right now</span>
              <span className={`v ${health.detection.primaryLane === 'webhook' ? 'ok' : health.detection.primaryLane === 'manual' ? 'warn' : ''}`}>
                {LANE_LABEL[health.detection.primaryLane]}
              </span>
            </div>

            <div className="kv">
              <span className="k">Push subscriptions</span>
              <span className="v">
                {health.detection.webhooks.registered
                  ? `${health.detection.webhooks.subscriptions} flight${health.detection.webhooks.subscriptions === 1 ? '' : 's'}`
                  : 'not registered'}
              </span>
            </div>

            {health.detection.webhooks.reason && (
              <p className="why" style={{ margin: '4px 0 10px' }}>
                {health.detection.webhooks.reason}
              </p>
            )}

            {health.detection.webhooks.providers.map((p) => (
              <div className="kv" key={p.provider}>
                <span className="k">{p.provider}</span>
                <span className={`v ${!p.configured ? '' : p.stale ? 'warn' : 'ok'}`}>
                  {!p.configured
                    ? 'not configured'
                    : `${p.deliveries} delivered · ${p.matched} matched · last ${ago(p.lastDeliveryAt)}${p.stale ? ' · STALE' : ''}`}
                </span>
              </div>
            ))}

            <div className="kv">
              <span className="k">Poller (fallback)</span>
              <span className={`v ${health.detection.poller.budgetRemaining ? '' : 'warn'}`}>
                {health.detection.poller.running
                  ? `${health.detection.poller.role} · ${health.detection.poller.callsThisMonth}/${health.detection.poller.ceiling} calls this month`
                  : 'not running'}
              </span>
            </div>

            {!health.detection.poller.budgetRemaining && (
              <p className="why" style={{ margin: '4px 0 0', color: 'var(--risk)' }}>
                The AviationStack allowance for this month is spent. Automatic polling has stopped —
                detection is push plus member reports until it resets.
              </p>
            )}
          </>
        )}
      </div>



      <div className="sect">Active disruptions</div>
      {!disruptions ? (
        <div className="g panel" style={{ marginBottom: 14 }} aria-hidden="true">
          <h3><SkLine w="6em" /></h3>
          <table className="tbl" style={{ marginTop: 8 }}>
            <thead>
              <tr>
                {['5em', '3em', '3.5em', '6em', '4em', '3em', '5em'].map((w, i) => (
                  <th key={w} className={i === 6 ? 'ar' : undefined}><SkLine w={w} /></th>
                ))}
              </tr>
            </thead>
            <tbody><SkTableRows cols={7} rows={2} /></tbody>
          </table>
        </div>
      ) : disruptions.length === 0 ? (
        <p style={{ color: 'var(--mist2)', fontSize: 13.5 }}>Nothing triggered right now.</p>
      ) : (
        disruptions.map((d) => (
          <div className="g panel" key={d.flightId} style={{ marginBottom: 14 }}>
            <h3>
              {d.flightCode}
              <span style={{ float: 'right', fontWeight: 400, color: 'var(--mist2)', fontSize: 12 }}>{d.phase}</span>
            </h3>
            <table className="tbl" style={{ marginTop: 8 }}>
              <thead>
                <tr>
                  <th>Passenger</th><th>Party</th><th>Phase</th><th>Seconds left</th>
                  <th>Chosen</th><th>Owed</th><th className="ar">Resolution</th>
                </tr>
              </thead>
              <tbody>
                {d.tasks.map((t) => (
                  <tr key={t.passengerId}>
                    <td>{t.passengerName}</td>
                    <td>{t.partySize}</td>
                    <td>{t.phase}</td>
                    <td>{t.phase === 'waiting' ? t.secondsLeft : '—'}</td>
                    <td>{t.chosenAltCode ?? '—'}</td>
                    <td>{t.owedNow ? money(t.owedNow) : 'no cost'}</td>
                    <td className="ar">{t.resolution ? t.resolution.kind : '—'}</td>
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
