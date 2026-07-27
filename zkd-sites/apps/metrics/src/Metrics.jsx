import React, { useState } from 'react';
import { CrossNav, ProofLink } from '@shared/components/index.jsx';
import {
  RUN, OUTCOMES, SCENARIOS, SENSITIVITY, BASELINE_SAME_DAY,
  METRICS, ASSUMPTIONS, NOT_MODELLED,
} from '@shared/data/sim.js';
import { PROOFS, TIERS } from '@shared/data/proofs.js';

const SOURCES = Object.entries(PROOFS)
  .filter(([, p]) => p.sources?.length)
  .map(([id, p]) => ({ id, ...p }));

export default function Metrics() {
  const [scenario, setScenario] = useState('all');
  const active = SCENARIOS.find((s) => s.id === scenario);
  const maxDelta = Math.max(...SENSITIVITY.map((s) => Math.abs(s.delta)));

  return (
    <>
      <CrossNav current="metrics" />

      <div className="shell">
        <header className="hero">
          <span className="kicker">Research · 250,000 simulated cases</span>
          <h1>Success metrics</h1>
          <p className="lede">
            Of our disrupted members, how many do we actually re-book — and under what conditions
            does that number collapse?
          </p>
          <div className="pills">
            <span className="pill solid">{RUN.n.toLocaleString('en-IN')} cases</span>
            <span className="pill">{RUN.events.toLocaleString('en-IN')} events</span>
            <span className="pill">seed {RUN.seed}</span>
          </div>
          <p className="dim" style={{ fontSize: '.86rem', maxWidth: '58ch' }}>
            Every figure below is a link. Each opens its own proof page in a <b>new tab</b> — formula,
            inputs, sources and how to reproduce it — so this page never loses your place or your
            filter.
          </p>
        </header>
      </div>

      <div className="band-alt"><div className="shell">
        <section id="headline">
          <div className="sec-head">
            <span className="sec-num">01</span>
            <span className="kicker">Headline</span>
            <h2>Four numbers, all of them checkable</h2>
          </div>
          <div className="tiles">
            <div className="tile t1"><span className="v"><ProofLink id="sim-outcome-a">52.8%</ProofLink></span><span className="k">Recovered on time</span><span className="s">Same-day seat, commitment kept</span></div>
            <div className="tile t2"><span className="v"><ProofLink id="sim-same-day">65.5%</ProofLink></span><span className="k">Same-day recovery</span><span className="s">Our headline metric</span></div>
            <div className="tile t3"><span className="v"><ProofLink id="sim-closed-no-human">93.2%</ProofLink></span><span className="k">Closed without a human</span><span className="s">Round 1 target ≥ 60%</span></div>
            <div className="tile t4"><span className="v"><ProofLink id="hold-ttl">₹0</ProofLink></span><span className="k">Charge on a failed prediction</span><span className="s">True by construction</span></div>
          </div>

          <div className="callout warn" style={{ marginTop: '1.6rem', maxWidth: 'var(--measure)' }}>
            <span className="kicker">Why we do not lead with 93.2%</span>
            <p>
              That metric moves only between <b>92.8% and 93.5%</b> across every sensitivity
              configuration we ran — including deliberately broken ones — because the
              next-day-plus-hotel fallback nearly always succeeds. A number that clears its target
              even when the system is misbuilt cannot tell us whether we are improving.
              <ProofLink id="sim-same-day"> Same-day recovery</ProofLink> spans 4.6% to 81.2% over the
              same runs, so that is what we are judged on.
            </p>
          </div>
        </section>
      </div></div>

      <div className="shell">
        <section id="outcomes">
          <div className="sec-head">
            <span className="sec-num">02</span>
            <span className="kicker">Outcome mix</span>
            <h2>The blended average hides the case we built for</h2>
          </div>

          <div className="segbtns" role="group" aria-label="Scenario">
            {SCENARIOS.map((s) => (
              <button key={s.id} type="button" onClick={() => setScenario(s.id)}
                className={`segbtn ${scenario === s.id ? 'on' : ''}`} aria-pressed={scenario === s.id}>
                {s.label}
              </button>
            ))}
          </div>
          <p className="dim" style={{ fontSize: '.85rem', marginTop: '.6rem' }}>{active.blurb}</p>

          <div className="card" style={{ marginTop: '1.2rem' }}>
            <div className="legend">
              {OUTCOMES.map((o) => (
                <span key={o.key}><i className="sw" style={{ background: `var(--${o.tone})` }} />{o.key} · {o.label}</span>
              ))}
            </div>
            <div className="stack">
              {OUTCOMES.map((o) => (
                <div key={o.key} className="seg" style={{ background: `var(--${o.tone})`, width: `${active[o.key]}%` }}
                     title={`${o.label}: ${active[o.key]}%`}>
                  {active[o.key] > 6 ? `${active[o.key]}%` : ''}
                </div>
              ))}
            </div>
            <div className="statrow">
              <div><span className="sl">Same-day</span><span className="sv">{active.sameDay}%</span></div>
              <div><span className="sl">Closed w/o human</span><span className="sv">{active.closed}%</span></div>
              <div><span className="sl">Median delay</span><span className="sv">{active.medianDelay} h</span></div>
            </div>
          </div>

          <div className="tw" style={{ marginTop: '1.2rem' }}>
            <table>
              <caption>Table view — the same data, for anyone who would rather read it</caption>
              <thead><tr><th>Scenario</th>{OUTCOMES.map((o) => <th key={o.key} className="n">{o.key} · {o.short}</th>)}<th className="n">Same-day</th><th className="n">Closed w/o human</th></tr></thead>
              <tbody>
                {SCENARIOS.map((s) => (
                  <tr key={s.id}>
                    <td><b>{s.label}</b></td>
                    {OUTCOMES.map((o) => <td key={o.key} className="n">{s[o.key]}%</td>)}
                    <td className="n">{s.proof ? <ProofLink id={s.proof}>{s.sameDay}%</ProofLink> : `${s.sameDay}%`}</td>
                    <td className="n">{s.closed}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="callout" style={{ marginTop: '1.4rem', maxWidth: 'var(--measure)' }}>
            <span className="kicker">Read the systemic row</span>
            <p>
              In a Dec-2025-scale event, same-day recovery falls to
              <ProofLink id="sim-regime-systemic"> 38.55%</ProofLink> and the duty-of-care path
              absorbs <b>49.71%</b> of members — half the book. That is precisely why Pipeline 05 is
              not a nice-to-have, and why we report the regimes separately instead of averaging them
              into something more flattering.
            </p>
          </div>
        </section>
      </div>

      <div className="band-alt"><div className="shell">
        <section id="sensitivity">
          <div className="sec-head">
            <span className="sec-num">03</span>
            <span className="kicker">Sensitivity</span>
            <h2>What actually moves the number</h2>
            <p className="prose" style={{ color: 'var(--text-mid)' }}>
              Change in same-day recovery against the {BASELINE_SAME_DAY}% baseline. Each run alters
              exactly one lever, everything else held.
            </p>
          </div>
          <div className="card">
            {SENSITIVITY.map((s) => {
              const pct = (Math.abs(s.delta) / maxDelta) * 45;
              const neg = s.delta < 0;
              return (
                <div className="torn" key={s.label}>
                  <span className="tl">{s.label}</span>
                  <span className="tt">
                    <i className="tz" />
                    <i className="tb" style={{
                      background: neg ? 'var(--neg)' : 'var(--pos)',
                      width: `${pct}%`,
                      left: neg ? `${50 - pct}%` : '50%',
                    }} />
                  </span>
                  <span className="tv" style={{ color: neg ? 'var(--neg)' : 'var(--pos)' }}>
                    {s.proof ? <ProofLink id={s.proof} plain>{s.delta > 0 ? '+' : '−'}{Math.abs(s.delta)}</ProofLink>
                             : <>{s.delta > 0 ? '+' : '−'}{Math.abs(s.delta)}</>}
                  </span>
                </div>
              );
            })}
          </div>

          <div className="callout good" style={{ marginTop: '1.5rem', maxWidth: 'var(--measure)' }}>
            <span className="kicker">What this told us to build first</span>
            <p>
              <b>Allocation beats prediction by more than three to one.</b> Portfolio allocation is
              worth <ProofLink id="sens-portfolio">+38.6</ProofLink>, supplier breadth
              <ProofLink id="sens-access"> +25.5</ProofLink>, prediction lead
              <ProofLink id="sens-prediction"> +11.4</ProofLink>. So we build Pipeline 01 and the
              coordinator before the Predictive Watcher, despite P2 ranking first on RICE — and that
              is the second reason, alongside the fact that P2 without P1 is simply Lumo.
            </p>
            <p className="mono" style={{ fontSize: '.78rem' }}>38.63 ÷ 11.35 = 3.4×</p>
          </div>
        </section>
      </div></div>

      <div className="shell">
        <section id="metrics">
          <div className="sec-head">
            <span className="sec-num">04</span>
            <span className="kicker">Definitions</span>
            <h2>Metrics defined so they can fail</h2>
          </div>
          <div className="tw">
            <table>
              <thead><tr><th>Metric</th><th>Definition</th><th className="n">Target</th><th className="n">Modelled</th></tr></thead>
              <tbody>
                {METRICS.map((m) => (
                  <tr key={m.name}>
                    <td>{m.primary || m.hard ? <b>{m.name}</b> : m.name}
                      {m.primary && <div className="dim" style={{ fontSize: '.82rem' }}>Primary — the one we are judged on</div>}</td>
                    <td style={{ color: 'var(--text-mid)' }}>{m.definition}</td>
                    <td className="n">{m.target}</td>
                    <td className="n">{m.proof ? <ProofLink id={m.proof}>{m.modelled}</ProofLink> : m.modelled}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <div className="band-alt"><div className="shell">
        <section id="assumptions">
          <div className="sec-head">
            <span className="sec-num">05</span>
            <span className="kicker">Assumptions register</span>
            <h2>Every input we could not source</h2>
            <p className="prose" style={{ color: 'var(--text-mid)' }}>
              None of these is measured. All of them are ours. The last column is the honest part —
              the measured swing in same-day recovery when each is pushed to its plausible extreme.
            </p>
          </div>
          <div className="tw">
            <table>
              <thead><tr><th>Input</th><th className="n">Value</th><th>Our basis for choosing it</th><th className="n">Measured impact</th></tr></thead>
              <tbody>
                {ASSUMPTIONS.map((a) => (
                  <tr key={a.name}>
                    <td>{a.influential ? <b>{a.name}</b> : a.name}</td>
                    <td className="n" style={{ whiteSpace: 'pre-line' }}>{a.value}</td>
                    <td style={{ color: 'var(--text-mid)' }}>{a.basis}</td>
                    <td className="n" style={{ color: a.bad ? 'var(--c4)' : undefined }}>
                      {a.proof ? <ProofLink id={a.proof}>{a.impact}</ProofLink> : a.impact}
                      {a.impactNote && <div className="dim" style={{ fontSize: '.78rem' }}>{a.impactNote}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="callout warn" style={{ marginTop: '1.4rem', maxWidth: 'var(--measure)' }}>
            <span className="kicker">What we are not claiming</span>
            <ul className="bul">{NOT_MODELLED.map((n, i) => <li key={i}>{n}</li>)}</ul>
            <p style={{ marginTop: '.5rem' }}>
              Both major omissions push the same way: <b>real same-day recovery will sit below these
              figures, not above.</b> We would rather publish a number that can only get worse under
              scrutiny than one that needs defending.
            </p>
          </div>
        </section>
      </div></div>

      <div className="shell">
        <section id="sources">
          <div className="sec-head">
            <span className="sec-num">06</span>
            <span className="kicker">Sources</span>
            <h2>Every external claim, linked</h2>
            <p className="prose" style={{ color: 'var(--text-mid)' }}>
              Where we could not retrieve a primary document, the row says so. We do not link to
              things we have not opened.
            </p>
          </div>
          <div className="tw">
            <table>
              <thead><tr><th>Proof</th><th className="n">Tier</th><th>Claim</th><th>Sources</th></tr></thead>
              <tbody>
                {SOURCES.map((s) => (
                  <tr key={s.id}>
                    <td><ProofLink id={s.id} plain>{s.id}</ProofLink></td>
                    <td className="n"><span className={`badge tone-${TIERS[s.tier].hue}`} style={{ verticalAlign: 'baseline', marginLeft: 0 }}>{TIERS[s.tier].label}</span></td>
                    <td style={{ color: 'var(--text-mid)' }}>{s.claim}</td>
                    <td>
                      <ul style={{ margin: 0, paddingLeft: '1rem', fontSize: '.86rem' }}>
                        {s.sources.map((x, k) => (
                          <li key={k}><a href={x.url} target="_blank" rel="noopener noreferrer">{x.label}</a></li>
                        ))}
                      </ul>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="callout" style={{ marginTop: '1.4rem', maxWidth: 'var(--measure)' }}>
            <span className="kicker">Reproduce the simulation</span>
            <p>
              <code>python iropssim.py</code> · seed <b>{RUN.seed}</b> · N = {RUN.n.toLocaleString('en-IN')}.
              Fixed seed, no clock or network input, so the run is deterministic — you get these
              numbers to the last decimal. The script sits beside this repo in the project folder.
            </p>
          </div>
        </section>

        <footer className="sitefoot">
          <span>Team ZKD · IIT Madras</span>
          <span>Success metrics · localhost:5174</span>
          <span>{RUN.n.toLocaleString('en-IN')} cases · {RUN.events.toLocaleString('en-IN')} events</span>
        </footer>
      </div>

      <style>{`
        .hero { padding: clamp(3rem,9vw,7rem) 0 clamp(2rem,4vw,3rem); display:flex; flex-direction:column; gap:1.3rem; }
        .lede { font-family:var(--f-serif); font-size:clamp(1.05rem,2.2vw,1.5rem); line-height:1.45;
                color:var(--text-mid); max-width:46ch; }
        .pills { display:flex; flex-wrap:wrap; gap:.5rem; }
        ul.bul { margin:0; padding-left:1.15rem; display:flex; flex-direction:column; gap:.45rem;
                 color:var(--text-mid); font-size:.93rem; }
        .segbtns { display:flex; gap:.4rem; flex-wrap:wrap; }
        .segbtn { font-family:var(--f-data); font-size:.68rem; letter-spacing:.11em; text-transform:uppercase;
                  font-weight:700; padding:.5rem 1rem; border-radius:999px; border:1px solid var(--rule);
                  background:var(--card); color:var(--text-mid); cursor:pointer; transition:.18s; }
        .segbtn:hover { color:var(--text); border-color:var(--text-dim); }
        .segbtn.on { background:var(--accent); border-color:var(--accent); color:#fff; }
        .legend { display:flex; flex-wrap:wrap; gap:.5rem 1.2rem; font-size:.82rem; color:var(--text-mid); }
        .legend span { display:inline-flex; align-items:center; gap:.45rem; }
        .sw { width:.75rem; height:.75rem; border-radius:3px; display:inline-block; }
        .stack { display:flex; height:3rem; gap:2px; }
        .stack .seg { display:flex; align-items:center; justify-content:center; font-family:var(--f-data);
                      font-size:.72rem; font-weight:700; color:#fff; overflow:hidden; white-space:nowrap;
                      transition:width .35s ease; }
        .stack .seg:first-child { border-radius:6px 0 0 6px; }
        .stack .seg:last-child { border-radius:0 6px 6px 0; }
        .statrow { display:flex; flex-wrap:wrap; gap:1.6rem; }
        .statrow div { display:flex; flex-direction:column; }
        .sl { font-family:var(--f-data); font-size:.6rem; letter-spacing:.12em; text-transform:uppercase; color:var(--text-dim); }
        .sv { font-family:var(--f-data); font-size:1.2rem; font-weight:700; font-variant-numeric:tabular-nums; }
        .torn { display:grid; grid-template-columns:14rem 1fr 4rem; gap:.8rem; align-items:center; margin-bottom:.35rem; }
        @media (max-width:760px){ .torn { grid-template-columns:1fr; gap:.15rem; } }
        .tl { font-size:.85rem; color:var(--text-mid); text-align:right; }
        @media (max-width:760px){ .tl { text-align:left; font-weight:600; color:var(--text); } }
        .tt { position:relative; display:block; height:1.8rem; background:var(--sunk);
              border:1px solid var(--rule-soft); border-radius:6px; }
        .tz { position:absolute; top:0; bottom:0; left:50%; width:1px; background:var(--rule); }
        .tb { position:absolute; top:3px; bottom:3px; border-radius:4px; }
        .tv { font-family:var(--f-data); font-size:.82rem; font-weight:700; font-variant-numeric:tabular-nums; }
        caption { text-align:left; padding:.7rem 1rem; font-size:.8rem; color:var(--text-dim); }
      `}</style>
    </>
  );
}
