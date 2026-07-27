import React, { useState } from 'react';
import { CrossNav, ProofLink } from '@shared/components/index.jsx';
import { PERSONAS, CONSENT_MODES } from '@shared/data/personas.js';

const inr = (n) => n === 0 ? '₹0' : `₹${n.toLocaleString('en-IN')}`;
const PAYER = {
  airline: { label: 'Airline', tone: 'c1' },
  member:  { label: 'Card Member', tone: 'c3' },
};

function Window({ w, note }) {
  return (
    <div className="win">
      <div className="winbar">
        <span className="wcap">Earliest start</span>
        <span className="wtrack"><i className="wfill" style={{ width: w.tight ? '26%' : '78%' }} /></span>
        <span className="wcap right">Latest end</span>
      </div>
      <div className="windates">
        <b>{w.earliest}</b>
        <span className={`wchip ${w.tight ? 'tight' : 'loose'}`}>
          {w.tight ? 'Tight window' : 'Generous window'} · ~{w.slackHours} h slack
        </span>
        <b>{w.latest}</b>
      </div>
      {note && <p className="winnote">{note}</p>}
    </div>
  );
}

function PersonaCard({ p, open, onToggle, onHover }) {
  const mode = CONSENT_MODES[p.mode];
  const total = p.costs.reduce((a, c) => a + c.amount, 0);
  return (
    <article id={`p-${p.id}`} className={`pcard ${open ? 'open' : ''}`}
             style={{ '--tone': `var(--${mode.tone})` }} onMouseEnter={onHover}>
      <button type="button" className="phead" onClick={onToggle} onFocus={onHover} aria-expanded={open}>
        <div className="pwho">
          <span className="ptier">Tier {mode.tier}</span>
          <h3>{p.name}</h3>
          <span className="pmode">{mode.label}</span>
        </div>
        <div className="pmeta">
          <span className="proute">{p.route.join(' → ')}</span>
          <span className={`pverdict v-${p.outcome.verdict}`}>{p.outcome.verdict} · {p.outcome.label}</span>
          <span className={`pcost ${total === 0 ? 'free' : ''}`}>{inr(total)} on card</span>
        </div>
        <span className="pchev" aria-hidden="true">{open ? '−' : '+'}</span>
      </button>

      {open && (
        <div className="pbody">
          <p className="phl">{p.headline}</p>
          <div className="pgrid">
            <div>
              <span className="lab">Trip</span>
              <p>{p.routeLabel} — {p.purpose}</p>
            </div>
            <div>
              <span className="lab">Booked with us</span>
              <p>
                {['flight', 'hotel', 'cab'].map((k) => (
                  <span key={k} className={`bk ${p.booked[k] ? 'yes' : 'no'}`}>{k}</span>
                ))}
              </p>
            </div>
            <div>
              <span className="lab">Disruption</span>
              <p><b>{p.disruption.flight}</b> at {p.disruption.at} — {p.disruption.kind}</p>
            </div>
            <div>
              <span className="lab">Consent mode</span>
              <p>{mode.blurb}</p>
            </div>
          </div>

          <span className="lab">Travel window the member gave us</span>
          <Window w={p.window} note={p.windowNote} />

          <span className="lab">What happened</span>
          <ol className="tl">
            {p.timeline.map((t, i) => (
              <li key={i} className={`c-${t.cost}`}>
                <span className="tt">{t.t}</span>
                <span className="tp">{t.phase}</span>
                <span className="tx">{t.text}</span>
              </li>
            ))}
          </ol>

          <span className="lab">Who paid for what</span>
          <div className="tw">
            <table>
              <thead><tr><th>Item</th><th className="n">Amount</th><th>Payer</th><th>Why</th></tr></thead>
              <tbody>
                {p.costs.map((c) => (
                  <tr key={c.item}>
                    <td>{c.item}</td>
                    <td className="n" style={{ color: c.amount === 0 ? 'var(--c1)' : 'var(--c3)' }}>{inr(c.amount)}</td>
                    <td><span className="payer" style={{ color: `var(--${PAYER[c.payer].tone})` }}>{PAYER[c.payer].label}</span></td>
                    <td style={{ color: 'var(--text-mid)' }}>{c.why}</td>
                  </tr>
                ))}
                <tr><td><b>Total on the Card</b></td>
                    <td className="n"><b style={{ color: total === 0 ? 'var(--c1)' : 'var(--c3)' }}>{inr(total)}</b></td>
                    <td colSpan={2} className="dim" style={{ fontSize: '.85rem' }}>
                      Claimed from the carrier wherever DGCA obliges them —
                      see <ProofLink id="dgca-care-thresholds" plain>the thresholds</ProofLink>.
                    </td></tr>
              </tbody>
            </table>
          </div>

          {p.walletNote && (
            <div className="callout" style={{ borderLeftColor: 'var(--c3)' }}>
              <span className="kicker" style={{ color: 'var(--c3)' }}>Wallet settlement</span>
              <p>{p.walletNote}</p>
            </div>
          )}

          <div className={`callout ${p.outcome.good ? 'good' : 'warn'}`}>
            <span className="kicker">Outcome — {p.outcome.verdict} · {p.outcome.label}</span>
            <p>{p.outcome.text}</p>
            {p.honest && <p style={{ marginTop: '.4rem' }}><b>{p.honest}</b></p>}
          </div>

          <div className="pproofs">
            <span className="lab">Proofs behind this scenario</span>
            <div className="pplist">
              {p.proofs.map((id) => <ProofLink key={id} id={id} plain>{id}</ProofLink>)}
            </div>
          </div>
        </div>
      )}
    </article>
  );
}

export default function Personas() {
  // A Set, not a single id: the point of this page is comparing the four, so
  // opening one must never close another.
  // One open at a time. Hover swaps which; clicking pins it so keyboard and
  // touch users are not at the mercy of wherever the mouse last drifted.
  const [open, setOpen] = useState(() => new Set(['priya']));
  const [pinned, setPinned] = useState(false);
  const toggle = (id) => setOpen((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
  const allOpen = open.size === PERSONAS.length;
  return (
    <>
      <CrossNav current="personas" />

      <div className="shell">
        <header className="hero">
          <span className="kicker">Four scenarios · the consent spectrum</span>
          <h1>Personas</h1>
          <p className="lede">
            Every one of them books the complete trip — flight, hotel and cab. What differs is who
            consents, who pays, and whether we manage it at all.
          </p>
          <div className="pills">
            {Object.values(CONSENT_MODES).map((m) => (
              <span key={m.key} className="pill" style={{ color: `var(--${m.tone})` }}>{m.label}</span>
            ))}
          </div>
        </header>

        <div className="introrow">
          <div className="callout">
            <span className="kicker">The travel window is the spine</span>
            <p>
              We ask every member two things up front: <b>the earliest date they can start</b> and
              <b> the latest date they must finish</b>. That window is a hard constraint the allocator
              optimises inside — and it is what decides whether a next-day recovery counts as a
              success or a failure. Priya cannot absorb a day. Rohit can. <b>Same system, same
              inventory, opposite verdicts</b> — because they told us their constraint before
              anything went wrong.
            </p>
          </div>
          <div className="atglance">
            <span className="lab">The four, at a glance</span>
            {PERSONAS.map((p) => {
              const m = CONSENT_MODES[p.mode];
              const total = p.costs.reduce((a, c) => a + c.amount, 0);
              return (
                <button key={p.id} type="button" className="glancerow"
                        style={{ '--tone': `var(--${m.tone})` }}
                        onClick={() => { setOpen(new Set([p.id]));
                          document.getElementById(`p-${p.id}`)?.scrollIntoView({ block: 'start' }); }}>
                  <span className="gname">{p.name}</span>
                  <span className="gmode">{m.label}</span>
                  <span className={`gcost ${total === 0 ? 'free' : ''}`}>{inr(total)}</span>
                  <span className={`gverdict v-${p.outcome.verdict}`}>{p.outcome.verdict}</span>
                </button>
              );
            })}
            <p className="glancenote">
              Three land on <b>A</b> — same day, commitment kept. One does not, and we show it rather
              than hide it.
            </p>
          </div>
        </div>

        <section id="cases" style={{ paddingTop: 0 }}>
          <div className="expandrow">
            <button type="button" className="segbtn"
                    onClick={() => { setPinned(true); setOpen(allOpen ? new Set([PERSONAS[0].id]) : new Set(PERSONAS.map((p) => p.id))); }}>
              {allOpen ? 'Show one at a time' : 'Expand all four to compare'}
            </button>
            <span className="dim" style={{ fontSize: '.82rem' }}>
              {pinned
                ? `${open.size} of ${PERSONAS.length} open · pinned — click a card to unpin`
                : 'Hover any card to open it · click to pin'}
            </span>
          </div>
          <div className="plist" onMouseLeave={() => { if (!pinned) setOpen(new Set([PERSONAS[0].id])); }}>
            {PERSONAS.map((p) => (
              <PersonaCard
                key={p.id} p={p} open={open.has(p.id)}
                onToggle={() => { toggle(p.id); setPinned(true); }}
                onHover={() => { if (!pinned) setOpen(new Set([p.id])); }}
              />
            ))}
          </div>
        </section>

        <footer className="sitefoot">
          <span>Team ZKD · IIT Madras</span>
          <span>Personas · localhost:5175</span>
          <span>Four scenarios · full trip booked in every one</span>
        </footer>
      </div>

      <style>{`
        .hero { padding: clamp(3rem,9vw,7rem) 0 clamp(1.6rem,3vw,2.4rem); display:flex; flex-direction:column; gap:1.3rem; }
        .lede { font-family:var(--f-serif); font-size:clamp(1.05rem,2.2vw,1.5rem); line-height:1.45;
                color:var(--text-mid); max-width:46ch; }
        .pills { display:flex; flex-wrap:wrap; gap:.5rem; }
        .plist { display:flex; flex-direction:column; gap:1rem; }
        .introrow { display:grid; gap:1rem; grid-template-columns:1fr; margin-bottom:2.4rem; align-items:stretch; }
        @media (min-width:980px){ .introrow { grid-template-columns:1.15fr .85fr; } }
        .atglance { background:var(--surface); border:1px solid var(--line); border-radius:var(--r);
                    padding:1.2rem 1.3rem; box-shadow:var(--lift); backdrop-filter:blur(6px);
                    display:flex; flex-direction:column; gap:.4rem; }
        .glancerow { display:grid; grid-template-columns:1fr auto auto 1.5rem; gap:.7rem; align-items:center;
                     padding:.55rem .2rem; border:0; border-bottom:1px solid var(--line-soft);
                     background:none; color:inherit; cursor:pointer; text-align:left; width:100%;
                     transition:background .16s ease, padding-left .16s ease; border-radius:6px; }
        .glancerow:hover { background:color-mix(in oklab, var(--fg) 5%, transparent); padding-left:.5rem; }
        .gname { font-weight:560; font-size:.92rem; }
        .gmode { font-family:var(--f-mono); font-size:.6rem; letter-spacing:.09em; text-transform:uppercase;
                 color:var(--tone); white-space:nowrap; }
        .gcost { font-family:var(--f-mono); font-size:.78rem; font-variant-numeric:tabular-nums;
                 color:var(--c3); white-space:nowrap; }
        .gcost.free { color:var(--c1); }
        .gverdict { font-family:var(--f-mono); font-size:.72rem; font-weight:700; text-align:right; }
        .gverdict.v-A { color:var(--c1); } .gverdict.v-C { color:var(--c3); }
        .glancenote { font-size:.82rem; color:var(--fg-dim); margin-top:.4rem; }
        .expandrow { display:flex; align-items:center; gap:1rem; flex-wrap:wrap; margin-bottom:1rem; }
        .segbtn { font-family:var(--f-data); font-size:.68rem; letter-spacing:.11em; text-transform:uppercase;
                  font-weight:700; padding:.5rem 1rem; border-radius:999px; border:1px solid var(--rule);
                  background:var(--card); color:var(--text-mid); cursor:pointer; transition:.18s; }
        .segbtn:hover { color:var(--text); border-color:var(--text-dim); }

        .pcard { background:var(--card); border:1px solid var(--rule-soft); border-top:4px solid var(--tone);
                 border-radius:var(--r); box-shadow:var(--shadow); overflow:hidden; }
        .phead { width:100%; display:grid; grid-template-columns:1fr auto 2rem; gap:1rem; align-items:center;
                 padding:1.3rem 1.4rem; background:none; border:0; cursor:pointer; text-align:left; color:inherit; }
        @media (max-width:820px){ .phead { grid-template-columns:1fr 2rem; } .pmeta { grid-column:1/-1; } }
        .pwho { display:flex; flex-direction:column; gap:.25rem; }
        .ptier { font-family:var(--f-data); font-size:.6rem; letter-spacing:.14em; text-transform:uppercase;
                 color:var(--tone); font-weight:800; }
        .pmode { font-size:.85rem; color:var(--text-dim); }
        .pmeta { display:flex; align-items:center; gap:.6rem; flex-wrap:wrap; }
        .proute, .pverdict, .pcost { font-family:var(--f-data); font-size:.66rem; letter-spacing:.09em;
                 text-transform:uppercase; font-weight:700; padding:.34rem .7rem; border-radius:999px;
                 border:1px solid var(--rule); color:var(--text-mid); white-space:nowrap; }
        .pverdict.v-A { color:var(--c1); border-color:currentColor; }
        .pverdict.v-C { color:var(--c3); border-color:currentColor; }
        .pcost.free { color:var(--c1); border-color:currentColor; }
        .pchev { font-family:var(--f-data); font-size:1.4rem; color:var(--text-dim); text-align:center; }
        .pbody { padding:0 1.4rem 1.5rem; display:flex; flex-direction:column; gap:1rem;
                 border-top:1px solid var(--rule-soft); }
        .phl { font-family:var(--f-serif); font-size:1.2rem; color:var(--text); margin-top:1.1rem; max-width:44ch; }
        .pgrid { display:grid; gap:1rem; grid-template-columns:1fr; }
        @media (min-width:760px){ .pgrid { grid-template-columns:1fr 1fr; } }
        .pgrid p { color:var(--text-mid); font-size:.93rem; }
        .lab { font-family:var(--f-data); font-size:.6rem; letter-spacing:.14em; text-transform:uppercase;
               color:var(--text-dim); font-weight:800; display:block; }
        .bk { display:inline-block; font-family:var(--f-data); font-size:.64rem; letter-spacing:.1em;
              text-transform:uppercase; font-weight:700; padding:.24rem .55rem; border-radius:999px;
              margin-right:.35rem; border:1px solid currentColor; }
        .bk.yes { color:var(--c1); } .bk.no { color:var(--text-dim); opacity:.5; text-decoration:line-through; }

        .win { display:flex; flex-direction:column; gap:.5rem; }
        .winbar { display:grid; grid-template-columns:auto 1fr auto; gap:.7rem; align-items:center; }
        .wcap { font-family:var(--f-data); font-size:.58rem; letter-spacing:.12em; text-transform:uppercase; color:var(--text-dim); }
        .wtrack { position:relative; height:.7rem; background:var(--sunk); border:1px solid var(--rule-soft); border-radius:999px; }
        .wfill { position:absolute; left:0; top:0; bottom:0; background:var(--tone); border-radius:999px; opacity:.75; }
        .windates { display:flex; justify-content:space-between; align-items:center; gap:.6rem; flex-wrap:wrap;
                    font-family:var(--f-data); font-size:.76rem; color:var(--text-mid); }
        .wchip { font-size:.6rem; letter-spacing:.1em; text-transform:uppercase; font-weight:700;
                 padding:.24rem .6rem; border-radius:999px; border:1px solid currentColor; }
        .wchip.tight { color:var(--c4); } .wchip.loose { color:var(--c1); }
        .winnote { font-size:.88rem; color:var(--text-dim); max-width:60ch; }

        ol.tl { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; }
        ol.tl li { display:grid; grid-template-columns:5rem 6.2rem 1fr; gap:.9rem; padding:.65rem 0;
                   border-bottom:1px solid var(--rule-soft); align-items:start; }
        @media (max-width:720px){ ol.tl li { grid-template-columns:1fr; gap:.15rem; } }
        ol.tl li:last-child { border-bottom:0; }
        .tt { font-family:var(--f-data); font-size:.74rem; color:var(--text-dim); font-variant-numeric:tabular-nums; }
        .tp { font-family:var(--f-data); font-size:.6rem; letter-spacing:.11em; text-transform:uppercase;
              font-weight:800; color:var(--text-dim); padding-top:.1rem; }
        .c-free .tp { color:var(--c1); } .c-member .tp { color:var(--c3); }
        .c-airline .tp { color:var(--c2); } .c-split .tp { color:var(--c2); }
        .tx { font-size:.92rem; color:var(--text-mid); }
        .payer { font-family:var(--f-data); font-size:.68rem; letter-spacing:.08em; text-transform:uppercase; font-weight:700; }
        .pproofs { display:flex; flex-direction:column; gap:.5rem; }
        .pplist { display:flex; flex-wrap:wrap; gap:.5rem; font-family:var(--f-data); font-size:.76rem; }
      `}</style>
    </>
  );
}
