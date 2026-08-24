'use client';

import { useState, useMemo, useId } from 'react';
import type { FlightForecast, FlightForecastSnapshot } from '@/lib/apiTypes';
import type { FeatureDataSource } from '@/server/engine/riskModel';

/**
 * The audit surface for a single flight's real prediction: the time-series
 * of every real score it has received (server/engine/forecast.ts's
 * appendHistory, fed by both on-demand refreshes and the interval batch
 * scorer), the real per-feature reasons behind the CURRENT score
 * (zkd-risk-model/src/inference.py's tree-SHAP explain()), and a "reverify"
 * action that forces a fresh real score and reports whether it reproduces.
 *
 * Every number on this panel traces to a real computation — there is
 * nothing here a designer chose to make the chart look fuller.
 */

const W = 640;
const H = 180;
const PAD = { top: 10, right: 14, bottom: 24, left: 34 };

/** Countdown to departure, not a clock time — "2h 14m before" reads directly
 *  as trajectory (further left = further out) instead of requiring the
 *  viewer to do the subtraction from the flight's own departure time. */
function fmtCountdown(depMs: number, atMs: number): string {
  const minsBefore = Math.round((depMs - atMs) / 60000);
  if (minsBefore <= 0) return 'at departure';
  if (minsBefore < 60) return `${minsBefore}m before`;
  const hrs = Math.floor(minsBefore / 60);
  const mins = minsBefore % 60;
  return mins === 0 ? `${hrs}h before` : `${hrs}h ${mins}m before`;
}

const HISTORY_WINDOW_MS = 8 * 60 * 60 * 1000;

/** Green while comfortably below the flight's own first threshold, amber once
 *  it's crossed into "prepare" territory, red at or past "pre-authorise" —
 *  the same three-way read as page.tsx's own threshold bar, applied per point
 *  instead of to a single current value. */
function colorFor(pct: number, thresholds: FlightForecast['thresholds']): string {
  if (pct >= thresholds.preAuthorise) return 'var(--risk)';
  if (pct >= thresholds.prepare) return 'var(--warn)';
  return 'var(--safe)';
}

function HistoryChart({
  history,
  thresholds,
  depISO,
}: {
  history: FlightForecastSnapshot[];
  thresholds: FlightForecast['thresholds'];
  depISO: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const depMs = useMemo(() => new Date(depISO).getTime(), [depISO]);
  // React's useId() includes colons (":r0:"), which url(#id) does not parse
  // reliably as a CSS/SVG reference — stripped down to plain alphanumerics.
  const gradId = `hist-grad-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;

  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  // riskScore — the 0-100 percentile RANK of this flight against the live
  // score distribution (server/engine/riskModel.ts) — is what this chart
  // plots, matching FlightForecastSnapshot.riskScore's own doc. pct (the
  // calibrated probability) still drives the gauge and every member-facing
  // banner; the rank is what this audit surface tracks over time. One
  // consequence, handled below: the prepare / pre-authorise reference bands
  // are defined in pct and have no fixed position on a rank axis, so they are
  // not drawn — per-point colour carries the band instead. Points recorded
  // before riskScore existed carry no rank and are skipped as a gap, exactly
  // as that field's doc notes.
  const usable = useMemo(() => {
    const withScore = history.filter((h) => typeof h.riskScore === 'number');
    if (withScore.length === 0) return withScore;
    const latest = withScore[withScore.length - 1].asOf;
    const windowed = withScore.filter((h) => h.asOf >= latest - HISTORY_WINDOW_MS);
    // A brand-new flight with one real point outside any sensible window is
    // still worth showing that one point, rather than an empty chart.
    return windowed.length > 0 ? windowed : withScore.slice(-1);
  }, [history]);

  // A rank can sit anywhere in 0-100, but a low-risk flight clusters low and a
  // fixed 0-100 axis would pin the line flat against the bottom and hide real
  // movement. Scale to what the data actually did, anchored at 0 (never a
  // sub-range that would exaggerate trivial noise into a dramatic-looking
  // swing), padded, and capped at 100 — a rank cannot exceed it.
  const domain = useMemo(() => {
    if (usable.length === 0) return { min: 0, max: 10 };
    const values = usable.map((h) => h.riskScore as number);
    const rawMax = Math.max(...values);
    const pad = Math.max(rawMax * 0.25, 1);
    return { min: 0, max: Math.min(100, Math.max(10, Math.ceil(rawMax + pad))) };
  }, [usable]);

  const yOf = (v: number) =>
    PAD.top + (1 - (v - domain.min) / (domain.max - domain.min)) * plotH;

  const points = useMemo(() => {
    if (usable.length === 0) return [];
    const t0 = usable[0].asOf;
    const t1 = usable[usable.length - 1].asOf;
    const span = Math.max(1, t1 - t0);
    return usable.map((h) => ({
      x: PAD.left + ((h.asOf - t0) / span) * plotW,
      y: yOf(h.riskScore as number),
      // Colour still encodes the real risk BAND (a pct-space classification),
      // so severity reads off the line even though its height is now the rank.
      color: colorFor(h.pct, thresholds),
      h,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usable, plotW, plotH, domain, thresholds]);

  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  // Bare rank numbers, not percentages — the axis is a 0-100 rank now.
  const tickFmt = (v: number) => String(Math.round(v));
  const ticks = Array.from({ length: 5 }, (_, i) => domain.min + (i * (domain.max - domain.min)) / 4);

  if (usable.length < 2) {
    return (
      <div style={{ padding: '28px 0', textAlign: 'center', color: 'var(--mist2)', fontSize: 13 }}>
        Collecting history — {usable.length} point{usable.length === 1 ? '' : 's'} so far. A new real score
        lands on the model's configured interval, or immediately if you hit refresh next to the score above.
      </div>
    );
  }

  const hovered = hover !== null ? points[hover] : null;

  return (
    <div style={{ position: 'relative' }}>
      <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Risk-score rank history over the last 8 hours">
        <defs>
          {/* One colour stop per real point, positioned at its own x — the line
              itself shifts from green to amber to red exactly where the
              probability did, the same "traffic on the route" read a maps app
              gives a road, rather than one flat colour for the whole line. */}
          <linearGradient id={gradId} gradientUnits="userSpaceOnUse" x1={PAD.left} y1="0" x2={W - PAD.right} y2="0">
            {points.map((p, i) => (
              <stop key={i} offset={points.length > 1 ? i / (points.length - 1) : 0} stopColor={p.color} />
            ))}
          </linearGradient>
        </defs>

        {/* No threshold reference bands here: prepare / pre-authorise are pct
            thresholds and have no fixed height on this rank axis. Severity is
            carried by each point's colour instead. */}

        {/* Recessive grid — ticks span the real auto-scaled rank domain */}
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={yOf(t)} y2={yOf(t)} stroke="rgba(255,255,255,.06)" strokeWidth={1} />
            <text x={PAD.left - 8} y={yOf(t) + 3} fontSize={9} textAnchor="end" fill="var(--mist2)" fontFamily="var(--mono)">{tickFmt(t)}</text>
          </g>
        ))}

        <path d={path} fill="none" stroke={`url(#${gradId})`} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />

        {points.map((p, i) => (
          <circle
            key={i} cx={p.x} cy={p.y} r={hover === i ? 5 : 3}
            fill={hover === i ? p.color : 'var(--bg)'} stroke={p.color} strokeWidth={2}
            onMouseEnter={() => setHover(i)}
            style={{ cursor: 'pointer' }}
          />
        ))}

        {/* Wide invisible hit targets — real markers are too small to hover precisely */}
        {points.map((p, i) => (
          <rect
            key={`hit-${i}`} x={p.x - (plotW / Math.max(1, points.length - 1)) / 2} y={PAD.top}
            width={plotW / Math.max(1, points.length - 1)} height={plotH}
            fill="transparent" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}
          />
        ))}
      </svg>

      {hovered && (
        <div
          style={{
            position: 'absolute', pointerEvents: 'none', transform: 'translate(-50%,-100%)',
            left: `${(hovered.x / W) * 100}%`, top: `${(hovered.y / H) * 100}%`, marginTop: -10,
            background: 'var(--glass-2)', border: '1px solid var(--edge-2)', borderRadius: 8,
            padding: '6px 10px', fontSize: 11.5, whiteSpace: 'nowrap', backdropFilter: 'var(--blur)',
          }}
        >
          <div style={{ fontFamily: 'var(--mono)', fontWeight: 600, color: hovered.color }}>
            {hovered.h.riskScore}<span style={{ color: 'var(--mist2)', fontWeight: 400 }}>/100 rank · {hovered.h.band}</span>
          </div>
          <div style={{ color: 'var(--mist2)' }}>{fmtCountdown(depMs, hovered.h.asOf)}</div>
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--mist2)', marginTop: 2 }}>
        <span>{fmtCountdown(depMs, usable[0].asOf)}</span>
        <span>{usable.length} real score{usable.length === 1 ? '' : 's'} · last 8h</span>
        <span>{fmtCountdown(depMs, usable[usable.length - 1].asOf)}</span>
      </div>
    </div>
  );
}

const SOURCE_LABEL: Record<FeatureDataSource, string> = {
  real: 'this entity’s own history',
  'synthetic-market-estimate': 'estimated from synthetic Indian-market reference data — not this carrier’s real history',
  'population-average': 'population average — no history yet for this one',
  unknown: 'not known for this flight',
};

function fmtValue(v: number | null): string {
  if (v === null) return 'unknown';
  return Number.isInteger(v) ? String(v) : v < 1 ? `${(v * 100).toFixed(2)}%` : v.toFixed(1);
}

function ContributionChart({
  explanation,
  dataSource,
}: {
  explanation: NonNullable<FlightForecast['explanation']>;
  dataSource: FlightForecast['dataSource'];
}) {
  const top = explanation.features.slice(0, 8);
  const maxShare = Math.max(...top.map((f) => f.relativeShare), 0.0001);

  return (
    <div>
      {top.map((f) => {
        const widthPct = (f.relativeShare / maxShare) * 100;
        const increases = f.direction === 'increases';
        const source = dataSource?.[f.feature] ?? 'real';
        const isFallback = source !== 'real';
        return (
          <div key={f.feature} style={{ padding: '5px 0' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 168, flex: 'none', fontSize: 11, color: 'var(--mist)', textAlign: 'right' }}>
                {FEATURE_LABEL[f.feature] ?? f.feature}
                <span style={{ display: 'block', fontFamily: 'var(--mono)', fontSize: 9.5, color: 'var(--mist2)' }}>
                  = {fmtValue(f.value)}
                </span>
              </div>
              <div style={{ flex: 1, position: 'relative', height: 16, background: 'rgba(255,255,255,.04)', borderRadius: 3 }}>
                <div
                  style={{
                    position: 'absolute', top: 0, bottom: 0,
                    left: increases ? '50%' : `${50 - widthPct / 2}%`,
                    width: `${widthPct / 2}%`,
                    background: increases ? 'var(--risk)' : 'var(--iris)',
                    borderRadius: 3,
                    opacity: isFallback ? 0.4 : 0.85,
                  }}
                />
                <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 1, background: 'var(--edge-2)' }} />
              </div>
              <div style={{ width: 56, flex: 'none', fontFamily: 'var(--mono)', fontSize: 10.5, color: increases ? 'var(--risk)' : 'var(--iris)' }}>
                {increases ? '+' : '−'}{Math.round(f.relativeShare * 100)}%
              </div>
            </div>
            {isFallback && (
              <div style={{ marginLeft: 178, fontSize: 9.5, color: 'var(--mist2)', fontStyle: 'italic' }}>
                {SOURCE_LABEL[source]}
              </div>
            )}
          </div>
        );
      })}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10, fontSize: 10.5, color: 'var(--mist2)' }}>
        <span><span style={{ color: 'var(--iris)' }}>■</span> pushes toward safe</span>
        <span><span style={{ color: 'var(--risk)' }}>■</span> pushes toward cancel</span>
      </div>
    </div>
  );
}

const FEATURE_LABEL: Record<string, string> = {
  carrier_hist_cancel_rate: "Carrier's cancellation history",
  route_hist_cancel_rate: 'This route’s history',
  origin_hist_cancel_rate: 'Origin airport history',
  dest_hist_cancel_rate: 'Destination airport history',
  origin_month_hist_cancel_rate: 'Seasonal (origin, this month)',
  month: 'Month',
  day_of_week: 'Day of week',
  hour_of_day: 'Hour of day',
  is_redeye: 'Red-eye departure',
  is_weekend: 'Weekend departure',
  distance_km: 'Route distance',
  sched_duration_min: 'Scheduled flight time',
  origin_hour_density: 'Origin schedule density',
  prior_leg_cancelled: "Aircraft's previous leg cancelled",
  international: 'International route',
};

/**
 * Split into two independent panels (rather than one bundled fragment) so a
 * caller can place "Prediction history" beside something else — the
 * booking's own boarding-pass card, in the current layout — instead of the
 * two always falling in one full-width vertical stack together.
 */
export function HistoryPanel({ forecast, history, depISO }: {
  forecast: FlightForecast;
  history: FlightForecastSnapshot[];
  depISO: string;
}) {
  return (
    <div className="g panel">
      <h3>Prediction history</h3>
      <HistoryChart history={history} thresholds={forecast.thresholds} depISO={depISO} />
    </div>
  );
}

export function ExplanationPanel({ forecast }: { forecast: FlightForecast }) {
  if (!forecast.explanation) return null;
  return (
    <div className="g panel">
      <h3>Why this number — real reasons, not a script</h3>
      <p style={{ margin: '0 0 14px', color: 'var(--mist)', fontSize: 13.5, lineHeight: 1.6 }}>
        Every bar below is a real contribution the model itself computed for this exact prediction
        (tree-SHAP) — not a canned explanation. Bars are sized by their share of the total swing away
        from the population baseline. Faded bars with an italic note are backed by the population
        average, not this specific carrier/route's own history — the model hasn't seen enough of its
        real outcomes yet to know better, and says so rather than presenting a guess as fact.
      </p>
      <ContributionChart explanation={forecast.explanation} dataSource={forecast.dataSource} />
    </div>
  );
}

export default function ForecastAudit({ forecast, history, depISO }: {
  forecast: FlightForecast;
  history: FlightForecastSnapshot[];
  depISO: string;
}) {
  return (
    <>
      <div style={{ marginBottom: 16 }}><HistoryPanel forecast={forecast} history={history} depISO={depISO} /></div>
      <ExplanationPanel forecast={forecast} />
    </>
  );
}
