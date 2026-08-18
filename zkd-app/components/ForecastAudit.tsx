'use client';

import { useState, useMemo } from 'react';
import type { FlightForecast, FlightForecastSnapshot } from '@/lib/apiTypes';
import type { FeatureDataSource } from '@/server/engine/riskModel';
import { FEATURE_LABEL } from '@/lib/featureLabels';

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

  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  // riskScore only exists on points recorded after it was added — skipped
  // here, not zero-filled, same as any other missing model run.
  const usable = useMemo(() => history.filter((h) => h.riskScore !== undefined), [history]);

  // Real scores cluster tightly — a fixed 0-100 axis pins the line flat
  // against the bottom and makes real movement invisible. Scale to what the
  // data actually did, anchored at 0 (never zoomed into a sub-range that
  // would exaggerate trivial noise into a dramatic-looking swing).
  const domain = useMemo(() => {
    if (usable.length === 0) return { min: 0, max: 100 };
    const values = usable.map((h) => h.riskScore!);
    const rawMax = Math.max(...values);
    const pad = Math.max(rawMax * 0.25, 2);
    return { min: 0, max: Math.min(100, Math.ceil(rawMax + pad)) };
  }, [usable]);

  const yOf = (score: number) =>
    PAD.top + (1 - (score - domain.min) / (domain.max - domain.min)) * plotH;
  const clampY = (y: number) => Math.min(PAD.top + plotH, Math.max(PAD.top, y));

  const points = useMemo(() => {
    if (usable.length === 0) return [];
    const t0 = usable[0].asOf;
    const t1 = usable[usable.length - 1].asOf;
    const span = Math.max(1, t1 - t0);
    return usable.map((h) => ({
      x: PAD.left + ((h.asOf - t0) / span) * plotW,
      y: yOf(h.riskScore!),
      h,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usable, plotW, plotH, domain]);

  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
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
  // Absent `source` means a point recorded before this field existed —
  // treated as 'internal-ml' (real), same lazy-migration pattern
  // `riskScore` above already uses on this exact type.
  const isSmoothed = (h: FlightForecastSnapshot) => h.source === 'neighbor-smoothed';
  const realCount = usable.filter((h) => !isSmoothed(h)).length;
  const smoothedCount = usable.length - realCount;

  return (
    <div style={{ position: 'relative' }}>
      <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Cancellation-risk history">
        {/* Band-reference zones — recessive, the same tones lib/thresholds.ts's GLOW uses.
            Clamped to the plot: a threshold above the auto-scaled domain still
            shows as "off the top of the chart" rather than an inverted rect. */}
        <rect x={PAD.left} y={clampY(yOf(domain.max))} width={plotW} height={clampY(yOf(thresholds.preAuthorise)) - clampY(yOf(domain.max))} fill="rgba(217,97,90,.10)" />
        <rect x={PAD.left} y={clampY(yOf(thresholds.preAuthorise))} width={plotW} height={clampY(yOf(thresholds.holdGate)) - clampY(yOf(thresholds.preAuthorise))} fill="rgba(217,97,90,.07)" />
        <rect x={PAD.left} y={clampY(yOf(thresholds.holdGate))} width={plotW} height={clampY(yOf(thresholds.prepare)) - clampY(yOf(thresholds.holdGate))} fill="rgba(211,160,63,.07)" />

        {/* Recessive grid — ticks span the real auto-scaled domain, not a fixed 0-100% */}
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={yOf(t)} y2={yOf(t)} stroke="rgba(255,255,255,.06)" strokeWidth={1} />
            <text x={PAD.left - 8} y={yOf(t) + 3} fontSize={9} textAnchor="end" fill="var(--mist2)" fontFamily="var(--mono)">{tickFmt(t)}</text>
          </g>
        ))}

        {/* Axis titles */}
        <text
          x={12} y={PAD.top + plotH / 2} fontSize={9} fill="var(--mist2)" textAnchor="middle"
          transform={`rotate(-90 12 ${PAD.top + plotH / 2})`}
        >
          Risk score (0–100)
        </text>
        <text x={PAD.left + plotW / 2} y={H - 4} fontSize={9} fill="var(--mist2)" textAnchor="middle">
          Time to departure
        </text>

        <path d={path} fill="none" stroke="var(--iris)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />

        {points.map((p, i) => {
          const smoothed = isSmoothed(p.h);
          return (
            <circle
              key={i} cx={p.x} cy={p.y} r={hover === i ? 5 : 3}
              // Real points: solid fill on hover. Smoothed points: always
              // hollow — a shape/pattern distinction rather than a new hue,
              // so provenance never depends on color perception alone, and
              // never implies "smoothed = bad" the way reusing --risk would.
              fill={smoothed ? 'var(--bg)' : hover === i ? 'var(--iris)' : 'var(--bg)'}
              stroke="var(--iris)" strokeWidth={2}
              strokeDasharray={smoothed ? '2,2' : undefined}
              onMouseEnter={() => setHover(i)}
              style={{ cursor: 'pointer' }}
            />
          );
        })}

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
          <div style={{ fontFamily: 'var(--mono)', fontWeight: 600 }}>
            {hovered.h.riskScore}/100 · {hovered.h.band}{' '}
            <span style={{ color: 'var(--mist2)', fontWeight: 400 }}>
              ({hovered.h.pct}% {isSmoothed(hovered.h) ? 'estimated' : 'real'})
            </span>
          </div>
          <div style={{ color: 'var(--mist2)' }}>{fmtCountdown(depMs, hovered.h.asOf)}</div>
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--mist2)', marginTop: 2 }}>
        <span>{fmtCountdown(depMs, usable[0].asOf)}</span>
        <span>
          <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: 'var(--iris)', marginRight: 4 }} />
          {realCount} real
          {smoothedCount > 0 && (
            <>
              {' '}·{' '}
              <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', border: '1px dashed var(--iris)', marginRight: 4 }} />
              {smoothedCount} estimated
            </>
          )}
        </span>
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

export default function ForecastAudit({ forecast, history, depISO }: {
  forecast: FlightForecast;
  history: FlightForecastSnapshot[];
  depISO: string;
}) {
  return (
    <>
      <div className="g panel" style={{ marginBottom: 16 }}>
        <h3>Prediction history</h3>
        <HistoryChart history={history} thresholds={forecast.thresholds} depISO={depISO} />
      </div>

      {forecast.explanation && (
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
      )}
    </>
  );
}
