import React, { useEffect, useRef, useState } from 'react';
import { PROOFS, TIERS, getProof } from '../data/proofs.js';
import { VectorField, useTheme, effectiveTheme } from './VectorField.jsx';
import './components.css';

export { VectorField, useTheme };

/* Palette handed to diagrams. The four chart hexes are the separately validated
   set and are reused verbatim so a diagram branch and a chart series that mean
   the same thing are the same colour. */
const DIAGRAM_PALETTE = {
  light: {
    c1: '#0F7A55', c2: '#2E6FB8', c3: '#D08A12', c4: '#C0392B',
    surface: '#FFFFFF', sunk: '#EFF1F4', line: '#C3CBD4',
    fg: '#141C24', mid: '#42525F', bg: '#F4F6F8',
  },
  dark: {
    c1: '#1F8A62', c2: '#3D7FC4', c3: '#B58810', c4: '#C9455A',
    surface: '#182430', sunk: '#101A23', line: '#31404E',
    fg: '#E3E9EF', mid: '#A7B5C1', bg: '#0E161F',
  },
};

/* ------------------------------------------------------------------ Badge */
export function Badge({ tier }) {
  const t = TIERS[tier];
  if (!t) return null;
  return <span className={`badge tone-${t.hue}`} title={t.blurb}>{t.label}</span>;
}

/* --------------------------------------------------------------- ProofLink
   Opens /proof/:id in a NEW TAB on this same origin, so the page the reader
   came from is never navigated away from — scroll position, filters and
   theme all survive untouched. That is the entire point.                    */
const APP = typeof __ZKD_APP__ !== 'undefined' ? __ZKD_APP__ : '';

/* Under HashRouter (Pages) the route lives after the hash; locally it is a real
   path that serve.js falls back for. Either way the link is absolute so
   target="_blank" opens a fresh tab rather than resolving against the current
   route. */
const proofHref = (id) =>
  PAGES ? `/${REPO}/${APP}/#/proof/${id}` : `/proof/${id}`;

export function ProofLink({ id, children, plain = false }) {
  const p = getProof(id);
  if (!p) {
    if (import.meta.env?.DEV) console.error(`[ProofLink] unknown proof id: "${id}"`);
    return <span className="proof-missing">{children}</span>;
  }
  return (
    <a
      className={plain ? 'proof-plain' : 'proof'}
      href={proofHref(id)}
      target="_blank"
      rel="noopener noreferrer"
      title={`${TIERS[p.tier].label} — ${p.claim}. Opens in a new tab.`}
      data-proof={id}
    >
      {children ?? p.value}
      {!plain && <Badge tier={p.tier} />}
    </a>
  );
}

/* ------------------------------------------------------------- ProofPage */
export function ProofPage({ id, site }) {
  const p = getProof(id);
  if (!p) {
    return (
      <div className="shell proofpage">
        <p className="kicker">Unknown proof</p>
        <h1>No entry for “{id}”</h1>
        <p className="prose dim" style={{ marginTop: '1rem' }}>
          Every number is registered in <code>packages/shared/data/proofs.js</code>. If you reached
          this from a link, that link references an id that no longer exists.
        </p>
      </div>
    );
  }
  const t = TIERS[p.tier];
  return (
    <div className="shell proofpage">
      <div className="proofhead">
        <span className={`badge big tone-${t.hue}`}>{t.label}</span>
        <span className="kicker">{site} · proof</span>
      </div>
      <h1 className="proofval">{p.value}</h1>
      <p className="proofclaim">{p.claim}</p>

      <div className="proofgrid">
        <section className="card">
          <h3>How it is computed</h3>
          <pre className="math">{p.formula}</pre>
          {p.reproduce && (
            <p className="dim" style={{ fontSize: '.88rem' }}>
              Reproduce with <code>{p.reproduce}</code> — fixed seed, no clock or network input, so the
              run is deterministic.
            </p>
          )}
        </section>

        <section className="card">
          <h3>What this tier means</h3>
          <p style={{ color: 'var(--text-mid)', fontSize: '.94rem' }}>{t.blurb}</p>
          {p.inputs?.length > 0 && (
            <>
              <h4 style={{ marginTop: '.4rem' }}>Inputs</h4>
              <ul className="inputs">
                {p.inputs.map((i, k) => <li key={k}>{i}</li>)}
              </ul>
            </>
          )}
        </section>

        {p.note && (
          <section className="card span2 note">
            <h3>What you should know about it</h3>
            <p style={{ color: 'var(--text-mid)' }}>{p.note}</p>
          </section>
        )}

        <section className="card span2">
          <h3>Sources</h3>
          {p.sources?.length ? (
            <ul className="srcs">
              {p.sources.map((s, k) => (
                <li key={k}>
                  <a href={s.url} target="_blank" rel="noopener noreferrer">{s.label}</a>
                  <span className="url">{s.url}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="dim" style={{ fontSize: '.94rem' }}>
              No external source — this figure is derived from other registered proofs or from our own
              simulation. Its inputs are listed above and each is separately traceable.
            </p>
          )}
        </section>
      </div>

      <p className="closetab">
        This opened in a new tab on purpose. Close it and the page you came from is exactly where you
        left it.
      </p>
    </div>
  );
}

/* --------------------------------------------------------------- Mermaid
   The render id MUST be unique per invocation, not derived from the chart
   content. React StrictMode mounts every effect twice in dev; a content-hashed
   id makes the second render collide with the first attempt's leftover node
   and the diagram silently never appears.                                    */
let mermaidSeq = 0;

export function Mermaid({ chart, caption }) {
  const ref = useRef(null);
  const [err, setErr] = useState(null);
  const theme = useTheme();   // re-render on toggle — a diagram left in the old
                              // theme after a switch is a visible bug

  useEffect(() => {
    let dead = false;
    const id = `mmd-${++mermaidSeq}`;

    (async () => {
      try {
        const mermaid = (await import('mermaid')).default;
        const dark = theme === 'dark';
        const P = DIAGRAM_PALETTE[dark ? 'dark' : 'light'];
        // {{token}} placeholders let a chart carry semantic colour without
        // hard-coding either theme's hexes at the call site
        const painted = chart.replace(/\{\{(\w+)\}\}/g, (m, k) => P[k] ?? m);
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'loose',
          theme: dark ? 'dark' : 'default',
          fontFamily: "'Geist', 'Segoe UI', system-ui, sans-serif",
          flowchart: { curve: 'basis', nodeSpacing: 26, rankSpacing: 40, padding: 8, useMaxWidth: false },
          themeVariables: {
            background: P.bg, primaryColor: P.surface, primaryTextColor: P.fg,
            primaryBorderColor: P.line, lineColor: P.line,
            secondaryColor: P.sunk, tertiaryColor: P.sunk, fontSize: '14px',
            // mermaid's default cluster is pale yellow — it fights every palette
            clusterBkg: P.sunk, clusterBorder: P.line,
            titleColor: P.mid, nodeTextColor: P.fg,
            edgeLabelBackground: P.bg, labelBoxBkgColor: P.sunk,
            labelBoxBorderColor: P.line, labelTextColor: P.mid,
          },
        });
        const { svg } = await mermaid.render(id, painted);
        if (!dead && ref.current) {
          ref.current.innerHTML = svg;
          setErr(null);
        }
      } catch (e) {
        // Surface it. A blank box that says nothing is worse than an error.
        if (!dead) setErr(String(e?.message || e).slice(0, 300));
      } finally {
        // mermaid parks a scratch node directly on <body>. Scope the cleanup to
        // body-level orphans — the rendered SVG carries this same id, so an
        // unscoped getElementById(id).remove() deletes the diagram we just drew.
        document
          .querySelectorAll(`body > [id="${id}"], body > [id="d${id}"]`)
          .forEach((n) => n.remove());
      }
    })();

    return () => { dead = true; };
  }, [chart, theme]);

  return (
    <figure className="figure">
      <div className="diagram" ref={ref}>
        {err && <pre className="math" style={{ color: 'var(--c4)' }}>Diagram failed to render: {err}</pre>}
      </div>
      {caption && <figcaption>{caption}</figcaption>}
    </figure>
  );
}

/* ----------------------------------------------------------- ThemeToggle */
export function ThemeToggle() {
  const [mode, setMode] = useState('light');
  useEffect(() => {
    const root = document.documentElement;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const eff = () => {
      const s = root.getAttribute('data-theme');
      return s === 'dark' || s === 'light' ? s : (mq.matches ? 'dark' : 'light');
    };
    try {
      const saved = localStorage.getItem('zkd-theme');
      if (saved === 'dark' || saved === 'light') root.setAttribute('data-theme', saved);
    } catch { /* storage blocked — session only */ }
    setMode(eff());
    const sync = () => setMode(eff());
    const mo = new MutationObserver(sync);
    mo.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
    mq.addEventListener?.('change', sync);
    return () => { mo.disconnect(); mq.removeEventListener?.('change', sync); };
  }, []);
  const flip = () => {
    const next = mode === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('zkd-theme', next); } catch { /* ignore */ }
    setMode(next);
  };
  return (
    <button type="button" className="themetoggle" onClick={flip} aria-label="Switch colour theme">
      {mode === 'light'
        ? <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></svg>
        : <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>}
      <span>{mode === 'light' ? 'Dark' : 'Light'}</span>
    </button>
  );
}

/* ---------------------------------------------------------------- Panels
   Exactly one panel is open. Hover opens it; click pins it so a keyboard or
   touch user is never stuck with whatever the mouse last grazed. */
export function Panels({ items, initial = 0 }) {
  const [open, setOpen] = useState(initial);
  const [pinned, setPinned] = useState(false);
  return (
    <div className="panels" onMouseLeave={() => { if (!pinned) setOpen(initial); }}>
      {items.map((it, i) => (
        <button
          key={it.key ?? i}
          type="button"
          className={`panel ${open === i ? 'on' : ''}`}
          style={{ '--tone': it.tone }}
          aria-expanded={open === i}
          onMouseEnter={() => { if (!pinned) setOpen(i); }}
          onFocus={() => setOpen(i)}
          onClick={() => { setOpen(i); setPinned((p) => !(p && open === i)); }}
        >
          <span className="panel-tag">{it.tag}</span>
          <span className="panel-title">{it.title}</span>
          {it.lede && <span className="panel-lede">{it.lede}</span>}
          <div className="panel-body">{it.body}</div>
          <span className="panel-hint">hover to open</span>
        </button>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------- CrossNav */
/* Build-time constants injected by vite.config.js (see deploy.config.js). */
const PAGES = typeof __ZKD_PAGES__ !== 'undefined' ? __ZKD_PAGES__ : false;
const REPO = typeof __ZKD_REPO__ !== 'undefined' ? __ZKD_REPO__ : '';
/* Absolute sibling URLs when the deploy target puts each app on its own
   domain (Vercel). Null everywhere else, so the port/sub-path logic stands. */
const SITE_URLS = typeof __ZKD_SITE_URLS__ !== 'undefined' ? __ZKD_SITE_URLS__ : null;
const SITES = typeof __ZKD_APPS__ !== 'undefined'
  ? __ZKD_APPS__
  : [
      { key: 'design', label: 'System design', port: 5173 },
      { key: 'metrics', label: 'Success metrics', port: 5174 },
      { key: 'personas', label: 'Personas', port: 5175 },
    ];

/* Sibling-site URLs.
   Local: three servers on three ports, derived from the host the page was
   actually served on — hardcoding localhost breaks the moment someone opens
   this from a phone, because it would point at THEIR machine.
   Pages: one origin, the three apps under sub-paths. */
const siteUrl = (site) => {
  if (SITE_URLS && SITE_URLS[site.key]) return SITE_URLS[site.key];
  if (PAGES) return `/${REPO}/${site.key}/`;
  if (typeof window === 'undefined') return `http://localhost:${site.port}/`;
  return `${window.location.protocol}//${window.location.hostname}:${site.port}/`;
};

export function CrossNav({ current, children }) {
  return (
    <>
    <VectorField />
    <div className="topbar">
      <div className="topbar-in">
        <a className="brand" href="/">Team <em>ZKD</em></a>
        <div className="topbar-right">
          <nav className="sitenav">
            {SITES.map((s) => (
              s.key === current
                ? <span key={s.key} className="sitelink on">{s.label}</span>
                : <a key={s.key} className="sitelink" href={siteUrl(s)}>{s.label}</a>
            ))}
          </nav>
          {children}
          <ThemeToggle />
        </div>
      </div>
    </div>
    </>
  );
}

export { PROOFS, TIERS, getProof };
