import { useState } from 'react';
import type { Policy, Row, State } from './App';

/** Splits `concierge.rebook.allow` so the rule itself reads louder than its package. */
function RulePath({ path }: { path: string }) {
  const i = path.lastIndexOf('.');
  if (i < 0) return <span className="rule">{path}</span>;
  return (
    <>
      <span className="pkg">{path.slice(0, i + 1)}</span>
      <span className="rule">{path.slice(i + 1)}</span>
    </>
  );
}

/**
 * The signature element: the "why" chip tears open into a policy receipt.
 * Every value in here is read from `decision_ledger` — the rule path, the
 * input that satisfied it, the decision id and the evaluation timestamp.
 */
function PolicyReceipt({ policy }: { policy: Policy }) {
  const input = policy.input.action ?? policy.input;
  const satisfying = Object.entries(input).filter(([k]) => k !== 'type');

  return (
    <div className="receipt">
      <div className="receipt-head">
        <span className="label">Policy receipt · Open Policy Agent</span>
        <span className="verdict">{policy.allowed ? 'ALLOW' : 'DENY'}</span>
      </div>
      <div className="receipt-body">
        <div className="rule-path">
          <RulePath path={policy.rulePath} />
        </div>
        <dl className="receipt-kv">
          <dt>input</dt>
          <dd>
            {satisfying.map(([k, v], n) => (
              <span className="pair" key={k}>
                {n > 0 && <span style={{ color: '#7b94ba' }}> · </span>}
                {k} <b>{typeof v === 'boolean' ? String(v) : Array.isArray(v) ? v.join(', ') : String(v)}</b>
              </span>
            ))}
          </dd>
          <dt>subject</dt>
          <dd>{policy.subject}</dd>
        </dl>
      </div>
      <div className="receipt-foot">
        <span>decision #{policy.decisionId}</span>
        <span>{policy.package}</span>
        <span>evaluated {policy.evalMs}ms</span>
        <span>{policy.timestamp}</span>
      </div>
    </div>
  );
}

function TimelineRow({ row, openByDefault }: { row: Row; openByDefault: boolean }) {
  const [open, setOpen] = useState(openByDefault);
  return (
    <div className="tl-row">
      <span className={`tl-node ${row.tone}`} />
      <div className="tl-main">
        <div>
          <div className="tl-title">{row.title}</div>
          <div className="tl-detail">{row.detail}</div>
        </div>
        <div className="tl-right">
          <div className={`tl-cost ${row.costInr < 0 ? 'credit' : ''}`}>{row.costLabel}</div>
          <span className="tl-status">{row.status}</span>
        </div>
      </div>
      <div className="why">
        <button
          className="why-chip"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          <span className="caret">{open ? '▾' : '▸'}</span> why
        </button>
        {open && row.policy && <PolicyReceipt policy={row.policy} />}
        {open && !row.policy && (
          <div className="receipt">
            <div className="receipt-body mono">No ledger entry for this row.</div>
          </div>
        )}
      </div>
    </div>
  );
}

export function Dashboard({ state, expand }: { state: State; expand: string | null }) {
  const d = state.disruption;
  const doc = state.dutyOfCare;
  // Default to the flight rebook — the decision with the most policy in it.
  const expandId = expand ?? state.timeline[0]?.id;

  return (
    <div className="shell" id="dashboard-root">
      <header className="topbar">
        <div className="brandmark">
          <span className="name">Amex Travel</span>
          <span className="eyebrow">Autonomous Disruption Concierge</span>
        </div>
        <span className="status-pill">
          <span className="dot" />
          {state.run.status === 'RECOVERED' ? 'Trip recovered' : state.run.status}
        </span>
      </header>

      <section className="hero">
        <div>
          <div className="eyebrow">Recovery plan · PNR {state.cardMember.pnr}</div>
          <h1>
            {state.cardMember.firstName}'s Chennai–London trip,
            <br />
            re-planned <em>before she reached the airport.</em>
          </h1>
          <div className="facts">
            <span>
              Card Member <b>{state.cardMember.name}</b>
            </span>
            <span>
              Regulator <b>{state.regulator}</b>
            </span>
            <span>
              Charged <b>{state.run.totalChargedLabel}</b>
            </span>
          </div>
        </div>

        <div className="disruption-card">
          <div className="row">
            <span className="leg">MAA → DEL</span>
            <span className="tag">CANCELLED</span>
          </div>
          <div className="sub">
            <b>{d.flight}</b> scheduled {d.scheduledDepartLabel} IST · cancelled {d.detectedAtLabel} IST
            <br />
            Invalidated the Delhi hotel, the airport transfer and the DEL→LHR connection.
          </div>
        </div>
      </section>

      <div className="grid">
        <main className="panel">
          <div className="panel-head">
            <h2>Recovered itinerary</h2>
            <span className="eyebrow">every action carries its receipt</span>
          </div>
          <div className="timeline">
            {state.timeline.map((row) => (
              <TimelineRow key={row.id} row={row} openByDefault={row.id === expandId} />
            ))}
          </div>
        </main>

        <aside className="rail">
          <section className="panel">
            <div className="panel-head">
              <h2>Decision ledger</h2>
            </div>
            <div className="tally">
              <div>
                <div className="n">{state.counts.decisions}</div>
                <div className="l">decisions</div>
              </div>
              <div>
                <div className="n allow">{state.counts.allow}</div>
                <div className="l">allowed</div>
              </div>
              <div>
                <div className="n deny">{state.counts.deny}</div>
                <div className="l">denied</div>
              </div>
            </div>
            <div style={{ marginTop: 14 }}>
              {state.decisions.map((dec) => (
                <div className="dec" key={dec.id}>
                  <span className={`mark ${dec.allowed ? 'allow' : 'deny'}`}>{dec.allowed ? '✓' : '✕'}</span>
                  <div>
                    <div className="subject">{dec.subject}</div>
                    <div className="path">{dec.rulePath}</div>
                    {!dec.allowed && dec.reasons.length > 0 && (
                      <div className="reason">{dec.reasons.join(' · ')}</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2>Duty of care</h2>
              <span className="eyebrow">{doc.currency}</span>
            </div>
            <div className="doc-owed">
              {doc.owed.map((o: string) => (
                <span key={o}>{o.replace(/_/g, ' ')}</span>
              ))}
            </div>
            <div style={{ marginTop: 10 }}>
              <div className="doc-line">
                <span className="k">Arrival delay</span>
                <span className="v">{doc.delayHours} h</span>
              </div>
              <div className="doc-line">
                <span className="k">Cancellation slab</span>
                <span className="v">₹{doc.slabInr.toLocaleString('en-IN')}</span>
              </div>
              <div className="doc-line">
                <span className="k">Cash compensation</span>
                <span className="v" style={{ color: '#2ecc9a' }}>
                  ₹{doc.compensationInr.toLocaleString('en-IN')}
                </span>
              </div>
            </div>
            <div className="regulation">{doc.regulation}</div>
          </section>

          <p className="rail-note">
            Nothing on this screen is hard-coded. Each <code>rule_path</code> is read from the{' '}
            <code>decision_ledger</code> table, written at the moment OPA evaluated the Rego.
          </p>
        </aside>
      </div>

      <div className="footline">
        <span>
          workflow {state.run.workflowId} · run {state.run.runId.slice(0, 18)}…
        </span>
        <span>Temporal · Open Policy Agent · recorded supplier fixtures</span>
      </div>
    </div>
  );
}
