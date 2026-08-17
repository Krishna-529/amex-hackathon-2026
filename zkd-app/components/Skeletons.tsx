import type { CSSProperties, ReactNode } from 'react';

/**
 * Skeleton placeholders.
 *
 * The rule every one of these follows: reuse the REAL layout class and put a
 * bar where the text goes. A `.uprow` skeleton is a `.uprow`; a panel skeleton
 * is a `.g.panel` with real `.kv` rows. That is what stops the layout jumping
 * when the data lands — a hand-rolled grey box that merely looks about right
 * is the thing being replaced here, not the thing being built.
 *
 * Bar heights are in `em` against each element's own font-size, so every
 * responsive type step (`.page-h h1` 38→31→27px, `.gauge .ringwrap` 210→174px)
 * is followed automatically with no breakpoint work here.
 *
 * Colour comes from `--sk-base` / `--sk-hi` (app/globals.css), redefined on
 * `.amex-page` / `.amex-header`. Nothing in this file knows which theme it is
 * rendering into, and it must stay that way.
 *
 * Widths are fixed literals, never random: these render on the server too, and
 * a random width is a hydration mismatch.
 */

type BarProps = {
  /** Width. A number is px; prefer `em`/`ch` strings so it tracks font-size. */
  w?: number | string;
  h?: number | string;
  style?: CSSProperties;
  className?: string;
};

export function SkLine({ w = '100%', h, style, className }: BarProps) {
  return (
    <span
      className={className ? `sk sk-line ${className}` : 'sk sk-line'}
      style={{ width: w, ...(h === undefined ? null : { height: h }), ...style }}
    />
  );
}

export function SkBlock({ w = '100%', h = 80, style, className }: BarProps) {
  return (
    <span
      className={className ? `sk sk-block ${className}` : 'sk sk-block'}
      style={{ width: w, height: h, ...style }}
    />
  );
}

/**
 * A run of bars standing in for a wrapped paragraph.
 *
 * The arithmetic matters, because getting it wrong is exactly the layout jump
 * this is meant to remove. Body copy in this app is `line-height:1.55`, so each
 * real line occupies 1.55em with .275em of half-leading above and below the
 * glyphs. Bars are 1em with .55em between them, and the .275em top and bottom
 * is *padding* on the wrapper — padding, not margin, because a margin on the
 * first child would collapse straight out through the `<p>` and shorten it.
 * Total: exactly 1.55em per line.
 */
export function SkText({ lines = 2, last = '62%', center = false, style }: {
  lines?: number;
  /** Width of the final, ragged line. */
  last?: string;
  /** For centred copy (`.pred .say`, `.gauge .say`). */
  center?: boolean;
  style?: CSSProperties;
}) {
  return (
    <span style={{ display: 'block', padding: '.275em 0', ...style }}>
      {Array.from({ length: lines }, (_, i) => (
        <SkLine
          key={i}
          w={i === lines - 1 ? last : '100%'}
          style={{
            display: 'block',
            marginTop: i ? '.55em' : 0,
            ...(center ? { marginLeft: 'auto', marginRight: 'auto' } : null),
          }}
        />
      ))}
    </span>
  );
}

/**
 * Wrapper for a whole-page skeleton. The placeholder tree is aria-hidden and
 * the only thing announced is `label`, so a screen reader hears "Loading your
 * flights" rather than a run of unlabelled boxes.
 */
export function SkRoot({ label, className = 'skeleton', children }: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={className} role="status" aria-busy="true" aria-live="polite">
      <span className="sk-sr">{label}</span>
      <div aria-hidden="true">{children}</div>
    </div>
  );
}

/* ── page head ──────────────────────────────────────────────────────────── */

export function SkPageHead({ w = '11ch', lines = 2, style }: {
  w?: string;
  lines?: number;
  style?: CSSProperties;
}) {
  return (
    <div className="page-h" style={style}>
      <h1><SkLine w={w} h=".72em" /></h1>
      <p><SkText lines={lines} last="58%" /></p>
    </div>
  );
}

export function SkSect({ w = '7em' }: { w?: string }) {
  return <div className="sect"><SkLine w={w} /></div>;
}

export function SkBack() {
  return <span className="back" style={{ display: 'inline-flex' }}><SkLine w="8em" /></span>;
}

/* ── panels ─────────────────────────────────────────────────────────────── */

const K_W = ['13em', '9em', '16em', '11em', '10em', '14em', '12em', '8.5em'];
const V_W = ['6em', '4.5em', '7em', '5em', '6.5em', '4em', '5.5em', '7.5em'];

/** A `.g.panel` with an eyebrow and `rows` key/value rows. */
export function SkPanel({ rows = 4, title = '12em', why = false, style }: {
  rows?: number;
  title?: string;
  /** Add the trailing `.why` explainer paragraph some panels carry. */
  why?: boolean;
  style?: CSSProperties;
}) {
  return (
    <div className="g panel" style={style}>
      <h3><SkLine w={title} /></h3>
      {Array.from({ length: rows }, (_, i) => (
        <div className="kv" key={i}>
          <span className="k"><SkLine w={K_W[i % K_W.length]} /></span>
          <span className="v"><SkLine w={V_W[i % V_W.length]} /></span>
        </div>
      ))}
      {why && <p className="why"><SkText lines={3} last="46%" /></p>}
    </div>
  );
}

/** One `.line-item` row of a `.plan-grp` (flight / room / cab). */
export function SkLineItem({ ic = '2em', t1 = '9em', t2 = '15em', r = '4.5em' }: {
  ic?: string; t1?: string; t2?: string; r?: string;
}) {
  return (
    <div className="line-item">
      <span className="ic"><SkLine w={ic} /></span>
      <span className="l">
        <span className="t1"><SkLine w={t1} /></span>
        <span className="t2"><SkLine w={t2} /></span>
      </span>
      <span className="r"><SkLine w={r} /></span>
    </div>
  );
}

export function SkPlanGroup({ label = '5em', items = 1 }: { label?: string; items?: number }) {
  return (
    <div className="plan-grp">
      <div className="lbl"><SkLine w={label} /></div>
      {Array.from({ length: items }, (_, i) => <SkLineItem key={i} />)}
    </div>
  );
}

/* ── flights list ───────────────────────────────────────────────────────── */

/** A `.route` line: two airport codes, times, and the duration rule between. */
export function SkRouteLine() {
  return (
    <div className="route">
      <div className="port">
        <div className="ap"><SkLine w="3ch" /></div>
        <div className="tm"><SkLine w="4.5ch" /></div>
      </div>
      <div className="mid">
        <div className="dur"><SkLine w="5ch" /></div>
        <div className="line" />
      </div>
      <div className="port to">
        <div className="ap"><SkLine w="3ch" /></div>
        <div className="tm"><SkLine w="4.5ch" /></div>
      </div>
    </div>
  );
}

/** One row of the upcoming-flights list. */
export function SkUpRow({ tag = false }: { tag?: boolean }) {
  return (
    <div className="uprow" style={{ pointerEvents: 'none' }}>
      <div style={{ minWidth: 0 }}>
        <div className="meta">
          <span className="code"><SkLine w="5.5em" /></span>
          {tag && <span className="tag"><SkLine w="3em" /></span>}
          <span className="when"><SkLine w="8em" /></span>
        </div>
        <SkRouteLine />
      </div>
    </div>
  );
}

/** The `.g.up` block: the list on the left, the prediction panel on the right. */
export function SkUpcoming({ rows = 3 }: { rows?: number }) {
  return (
    <div className="g up">
      <div className="up-list">
        {Array.from({ length: rows }, (_, i) => <SkUpRow key={i} tag={i === 0} />)}
      </div>
      <div className="pred">
        <div className="eyebrow"><SkLine w="8em" /></div>
        <div className="n"><SkLine w="2.4ch" h=".8em" /></div>
        <div className="lb"><SkLine w="7em" /></div>
        <div className="say"><SkText lines={2} last="64%" center /></div>
        <div className="go"><SkLine w="10em" /></div>
      </div>
    </div>
  );
}

/* ── tables ─────────────────────────────────────────────────────────────── */

/** Matches components/HistoryTable — same `.tbl` columns, same row height. */
export function SkHistoryTable({ rows = 4 }: { rows?: number }) {
  return (
    <div className="g" style={{ overflow: 'hidden' }}>
      <table className="tbl">
        <thead>
          <tr>
            <th><SkLine w="4em" /></th>
            <th><SkLine w="4em" /></th>
            <th><SkLine w="3em" /></th>
            <th className="ar"><SkLine w="5em" /></th>
          </tr>
        </thead>
        <tbody style={{ pointerEvents: 'none' }}>
          {Array.from({ length: rows }, (_, i) => (
            <tr key={i}>
              <td className="fc"><SkLine w="4.5em" /></td>
              <td className="rt"><SkLine w="12em" /></td>
              <td className="dt">
                <SkLine w="7em" />
                <span className="exact"><SkLine w="6em" /></span>
              </td>
              <td className="ar"><span className="pill done"><SkLine w="4.5em" /></span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const CELL_W = ['5em', '8em', '4.5em', '10em', '3em', '6em', '7em'];

/** Placeholder `<tr>`s for an arbitrary `.tbl` — used by the operator console. */
export function SkTableRows({ cols, rows = 4 }: { cols: number; rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }, (_, r) => (
        <tr key={r} aria-hidden="true" style={{ pointerEvents: 'none' }}>
          {Array.from({ length: cols }, (_, c) => (
            <td key={c} className={c === cols - 1 ? 'ar' : undefined}>
              <SkLine w={CELL_W[(r + c) % CELL_W.length]} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

/* ── recovery timeline ──────────────────────────────────────────────────── */

/** `.ev warm` rather than `.ev done`: warm is the muted variant, and it has no
 *  `::after` tick, so the placeholder never claims a step already finished. */
export function SkTimeline({ steps = 3 }: { steps?: number }) {
  return (
    <div className="tl">
      {Array.from({ length: steps }, (_, i) => (
        <div className="ev warm" key={i}>
          <div className="h">
            <span className="n"><SkLine w={i % 2 ? '9em' : '13em'} /></span>
            <span className="t"><SkLine w="3em" /></span>
          </div>
          <div className="s"><SkText lines={2} last="55%" /></div>
        </div>
      ))}
    </div>
  );
}

/* ── the risk gauge ─────────────────────────────────────────────────────── */

export function SkGauge({ style }: { style?: CSSProperties }) {
  return (
    <div className="g gauge" style={style}>
      <div className="ringwrap">
        <span className="sk sk-ring" />
        <div className="val">
          <div className="n"><SkLine w="2.2ch" h=".78em" /></div>
          <div className="c"><SkLine w="6em" /></div>
        </div>
      </div>
      <div className="band"><SkLine w="9em" /></div>
      {/* `.gauge` centres its children rather than stretching them, so a
          percentage-width placeholder needs the width said out loud or the
          flex item shrinks to nothing. `.say`'s own max-width:36ch still caps it. */}
      <div className="say" style={{ width: '100%' }}><SkText lines={2} last="70%" center /></div>
    </div>
  );
}
