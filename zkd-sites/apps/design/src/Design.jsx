import React from 'react';
import { CrossNav, ProofLink, Mermaid, Panels } from '@shared/components/index.jsx';

const ARCH = `flowchart LR
  WATCH["<b>WATCHER</b><br/>disruption +<br/>prediction signals"]
  SUPV["<b>SUPERVISOR</b><br/>routes, never calls<br/>a supplier itself"]
  WATCH ==> SUPV

  subgraph AGENTS[" SUB-AGENTS — tool-callers with no authority "]
    direction TB
    WX["Weather agent<br/><i>met + risk</i>"]
    FLT["Flight agent<br/><i>reshop · hold · book</i>"]
    HTL["Hotel agent<br/><i>re-accommodation</i>"]
    GRD["Ground agent<br/><i>cab · transfer</i>"]
    DOC["Duty-of-care agent<br/><i>DGCA entitlement</i>"]
  end

  SUPV --> WX & FLT & HTL & GRD & DOC
  WX & FLT & HTL & GRD & DOC ==> |"schema-validated proposal"| POL

  POL{"<b>POLICY GATE</b><br/>OPA / Rego<br/>default deny"}
  CON{"<b>CONSENT GATE</b><br/>tier A / B / C<br/>notify · wait · act"}
  EXEC["<b>EXECUTOR</b><br/>Temporal saga"]
  SAND["<b>SANDBOXES</b><br/>Duffel · LiteAPI<br/>FCM · free tiers"]
  ESC(["<b>ESCALATE</b><br/>human handoff"])

  POL ==> |pass| CON
  POL --> |deny| ESC
  CON ==> |"both gates passed"| EXEC
  CON --> |"no consent · timeout"| ESC
  EXEC ==> |"the only node that touches a supplier"| SAND

  classDef plan fill:{{surface}},stroke:{{c2}},stroke-width:1px,color:{{fg}}
  classDef gate fill:{{surface}},stroke:{{c3}},stroke-width:2.5px,color:{{fg}}
  classDef exec fill:{{surface}},stroke:{{c1}},stroke-width:2px,color:{{fg}}
  classDef mute fill:{{sunk}},stroke:{{line}},stroke-width:1px,color:{{mid}}
  classDef bad  fill:{{surface}},stroke:{{c4}},stroke-width:1.5px,color:{{fg}}
  class WATCH,SUPV,WX,FLT,HTL,GRD,DOC plan
  class POL,CON gate
  class EXEC exec
  class SAND mute
  class ESC bad
  linkStyle default stroke:{{line}}
`;

const TRIPSTATE = 'TripState { disruption · pnr · consent_tier · candidates[] · policy_decisions[] · holds[] · confirmed[] · escalation? }';

const FLOW_BEFORE = `flowchart LR
  S1["Signal arrives<br/><i>prediction or carrier</i>"] -- "new, not a duplicate" --> S3["<b>WARM</b><br/>PNR · trip DAG<br/>entitlement · window"]
  S3 --> S4["<b>COORDINATOR</b><br/>one reshop for<br/>the whole route"]
  S4 --> S5["<b>PORTFOLIO</b><br/>ranked candidates,<br/>held in memory only"]
  S5 --> S6["<b>ASK EARLY</b><br/>consent to the outcome,<br/>not to a seat"]
  S6 ==> INV{"Does the member still<br/>hold a live booking?"}
  INV ==> |"yes — the original is alive"| NOHOLD["<b>NO BOOKING MAY EXIST</b><br/>one live booking per passenger<br/>per date · a hold IS a booking"]
  NOHOLD ==> WAIT{"<b>WAIT</b><br/>has the carrier<br/>actually acted?"}
  WAIT -- "not yet · refresh candidates" --> S5
  WAIT ==> |"CARRIER ACTED — original segment is now dead"| NEXT(["continues below"])

  ALT["Route-level inventory<br/><i>anonymous group allotment</i>"] -. "only nameless path,<br/>needs a carrier agreement" .-> S4

  classDef prep fill:{{surface}},stroke:{{c2}},stroke-width:1px,color:{{fg}}
  classDef gate fill:{{surface}},stroke:{{c3}},stroke-width:2.5px,color:{{fg}}
  classDef bad  fill:{{surface}},stroke:{{c4}},stroke-width:2px,color:{{fg}}
  classDef mute fill:{{sunk}},stroke:{{line}},stroke-width:1px,color:{{mid}}
  class S1,S3,S4,S5,S6 prep
  class INV,WAIT gate
  class NOHOLD bad
  class NEXT,ALT mute
  linkStyle default stroke:{{line}}
`;

const FLOW_AFTER = `flowchart LR
  WAIT{"<b>WAIT</b><br/>carrier acted"} ==> NEG["<b>NEGOTIATE IN MEMORY</b><br/>max 3 iterations, zero<br/>supplier calls, milliseconds"]
  NEG ==> ALLOC["<b>ALLOCATE</b><br/>min-cost assignment<br/>across the portfolio"]
  ALLOC ==> GATE{"<b>OPA</b><br/>involuntary? window?<br/>consent tier? budget?"}
  GATE -- deny --> ESC
  GATE ==> |allow| SAGA["<b>TEMPORAL SAGA</b><br/>compensation registered<br/>before each side effect"]
  SAGA --> OK{"All activities<br/>succeed?"}

  OK -- no --> COMP["LIFO<br/>compensation"]
  COMP --> CQ{"Complete<br/>cleanly?"}
  CQ -- yes --> ORIG(["Original itinerary<br/>intact"])
  CQ -- "partial / async" --> ESC

  OK ==> |yes| DISP["<b>DISPOSE ORIGINAL</b><br/>last, and only now<br/><i>involuntary · airline pays</i>"]
  DISP ==> ONW{"Onward legs<br/>survived?"}
  ONW -- no --> ESC
  ONW ==> |yes| CARE["<b>CLAIM DUTY OF CARE</b><br/>meals · hotel · transfer,<br/>from the carrier"]
  CARE ==> DONE(["<b>CONFIRMED</b><br/>settle only the<br/>uncovered remainder"])
  ESC(["<b>ESCALATE</b> · Pipeline 04<br/>a human inherits<br/>the full context"])

  classDef prep fill:{{surface}},stroke:{{c2}},stroke-width:1px,color:{{fg}}
  classDef gate fill:{{surface}},stroke:{{c3}},stroke-width:2.5px,color:{{fg}}
  classDef good fill:{{surface}},stroke:{{c1}},stroke-width:2px,color:{{fg}}
  classDef bad  fill:{{surface}},stroke:{{c4}},stroke-width:2px,color:{{fg}}
  class ALLOC,SAGA,DISP,OK,CQ,ONW,NEG prep
  class WAIT,GATE gate
  class CARE,DONE,ORIG good
  class ESC,COMP bad
  linkStyle default stroke:{{line}}
`;

const BURST = `flowchart LR
  EV["<b>Mass cancellation</b><br/>2,507 flights · 3 lakh<br/>passengers · 72 h"] --> GRP{"Group by<br/>disrupted route"}
  GRP --> CO1["Coordinator<br/>MAA → DEL"]
  GRP --> CO2["Coordinator<br/>BOM → DEL"]
  CO1 --> RS["<b>ONE reshop</b><br/>request coalescing<br/>jittered backoff"]
  RS --> PORT["<b>PORTFOLIO</b><br/>not one best flight"]
  PORT ==> ALLOC{"<b>Min-cost assignment</b><br/>passengers × seats"}
  ALLOC ==> |"hard constraint<br/>at risk"| A1(["09:40 direct"])
  ALLOC ==> |"onward-leg<br/>cascade"| A2(["10:15 other carrier"])
  ALLOC ==> |"duty-of-care<br/>exposure"| A3(["via BLR, arrives 13:20"])
  ALLOC ==> |"flexible<br/>window"| A4(["later direct<br/>+ hotel + care claimed"])
  ALLOC --> |"block exhausted"| NEXT(["Next block,<br/>or escalate"])

  classDef prep fill:{{surface}},stroke:{{c2}},stroke-width:1px,color:{{fg}}
  classDef gate fill:{{surface}},stroke:{{c3}},stroke-width:2.5px,color:{{fg}}
  classDef good fill:{{surface}},stroke:{{c1}},stroke-width:1.5px,color:{{fg}}
  classDef bad  fill:{{surface}},stroke:{{c4}},stroke-width:1.5px,color:{{fg}}
  class EV,GRP,CO1,CO2,RS,PORT prep
  class ALLOC gate
  class A1,A2,A3,A4 good
  class NEXT bad
  linkStyle default stroke:{{line}}
`;

export default function Design() {
  return (
    <>
      <CrossNav current="design" />

      <div className="shell">
        <header className="hero">
          <span className="kicker">Codestreet 2026 · American Express · Round 1</span>
          <h1>System design</h1>
          <p className="lede">
            Two layers, an authority gate between them, and an honest account of what this costs to
            run at the scale we size for.
          </p>
          <div className="pills">
            <span className="pill solid">Scalability from arithmetic</span>
            <span className="pill">Feasibility from access ratings</span>
            <span className="pill">Every number traceable</span>
          </div>
          <p className="dim" style={{ fontSize: '.86rem', maxWidth: '58ch' }}>
            Numbers on this page are links. Each opens its own proof page in a new tab — formula,
            inputs and source — so this page keeps its place.
          </p>
        </header>
      </div>

      <div className="band-alt"><div className="shell">
        <section id="arch">
          <div className="sec-head">
            <span className="sec-num">01</span>
            <span className="kicker">Architecture</span>
            <h2>Cognition and authority are physically separated</h2>
            <p className="prose" style={{ color: 'var(--text-mid)' }}>
              The load-bearing claim is not that the system has layers. It is that the part which
              thinks has <b>no network route</b> to the part which spends.
            </p>
          </div>

          <Panels
            initial={1}
            items={[
              {
                key: 'a', tone: 'var(--c2)', tag: 'Zero execution authority',
                title: 'Layer A — Planning and Negotiation',
                lede: 'All cognition lives here, and nothing else does.',
                body: (
                  <ul>
                    <li>LangGraph supervisor <b>routes</b>; it never calls a supplier itself.</li>
                    <li>Sub-agents are <b>strict tool-callers</b> returning schema-validated proposals.</li>
                    <li>Context assembly: PNR, trip DAG, entitlement, and the traveller's <b>travel window</b>.</li>
                    <li>Negotiation capped at 3 iterations with an oscillation guard, over a single
                        pre-fetched candidate set — zero extra supplier calls.</li>
                    <li>MCP clients here are <b>read-only</b>: search, reshop, price.</li>
                  </ul>
                ),
              },
              {
                key: 'g', tone: 'var(--c3)', tag: 'Authority lives here',
                title: 'The Control Plane',
                lede: 'Every proposal crosses this boundary, or it does not execute.',
                body: (
                  <ul>
                    <li>OPA, Rego, <b>default deny</b>, decision log.</li>
                    <li>Consent tier, travel window, offer expiry, allocation priority and
                        <b> voluntary-versus-involuntary disposition</b> are all policy inputs.</li>
                    <li>A negotiated bargain that breaks a hard constraint is <b>denied</b>, not
                        ranked lower.</li>
                    <li>A voluntary cancellation is denied outright under autopilot.</li>
                    <li>Runs as a sidecar — <ProofLink id="opa-latency">~1 ms</ProofLink>, and no
                        network failure mode on the critical path.</li>
                  </ul>
                ),
              },
              {
                key: 'b', tone: 'var(--c1)', tag: 'Sole owner of side effects',
                title: 'Layer B — Durable Execution',
                lede: 'Temporal alone. One orchestrator, one failure model.',
                body: (
                  <ul>
                    <li>One idempotency story — no second scheduler to disagree with.</li>
                    <li>Compensation registered <b>before</b> each side effect; unwinds LIFO.</li>
                    <li>Idempotency keys from <code>(workflowID, activityID)</code> — attempt-invariant,
                        so an at-least-once retry cannot double-book.</li>
                    <li><b>Compensation initiated</b> and <b>completed</b> are distinct states.</li>
                    <li>Disposal of the original is <b>terminal</b> — last, only on success, outside
                        the LIFO chain because a cancellation has no inverse.</li>
                  </ul>
                ),
              },
            ]}
          />

          <Mermaid chart={ARCH} caption={<><b>Sub-agents propose. Only the executor acts — and only after the policy gate and the consent gate both pass.</b> The two gates are not the same thing: policy is a synchronous decision about whether an action is permissible at all; consent is a <em>wait</em> — a quiet window under tier A, sized from the supplier's own offer expiry rather than a fixed number, and an explicit approval under tier B.</>} />

          <div className="math" style={{ marginTop: '1.2rem' }}>{TRIPSTATE}</div>
          <p className="dim" style={{ fontSize: '.86rem', marginTop: '.7rem', maxWidth: 'var(--measure)' }}>
            The shared state every node reads and writes. <code>policy_decisions[]</code> and{' '}
            <code>holds[]</code> are what make the invariant testable — one OPA allow and one
            registered compensation for every side effect.
          </p>

          <div className="callout" style={{ marginTop: '1.4rem', maxWidth: 'var(--measure)' }}>
            <span className="kicker">How the agents are harnessed</span>
            <ul className="bul">
              <li>Sub-agents are tool-callers with <b>no authority</b> — each returns a schema-validated proposal.</li>
              <li>Only the executor node touches a supplier, through the Temporal saga.</li>
              <li>Consent tier is an <b>OPA input, not a UI setting</b> — one policy gates fare, cabin and who may confirm.</li>
              <li>Max 3 supervisor iterations, no cycle without progress, unroutable state exits to escalation.</li>
            </ul>
          </div>
        </section>
      </div></div>

      <div className="shell">
        <section id="flow">
          <div className="sec-head">
            <span className="sec-num">02</span>
            <span className="kicker">Recovery flow</span>
            <h2>Nothing irreversible happens left of the WAIT gate</h2>
            <p className="prose" style={{ color: 'var(--text-mid)' }}>
              Everything to its right is triggered by the carrier — which is precisely what makes the
              re-route free and keeps the statutory entitlement intact.
              See <ProofLink id="hold-ttl" plain>hold_TTL</ProofLink> for the hold gate.
            </p>
          </div>
          <div className="callout warn" style={{ maxWidth: 'var(--measure)', marginBottom: '1.4rem' }}>
            <span className="kicker">The constraint that shapes this half</span>
            <p>
              A hold <b>is</b> a booking — a named PNR or NDC order. So a passenger may hold
              <ProofLink id="one-booking-invariant"> at most one live booking</ProofLink> per travel
              date, and two is a duplicate that carriers cancel by automated sweep. While the
              original ticket is alive we therefore <b>cannot hold anything in the member's name at
              all</b>. Speculative pre-holding is not unwise here — it is impossible.
            </p>
            <p>
              Which is why the left half of this flow books nothing. It ranks candidates in memory
              and waits. The only nameless way to secure inventory early is a negotiated group
              allotment, which we do not have — making the Sabre onboarding ask architectural, not
              a nice-to-have.
            </p>
          </div>
          <Mermaid chart={FLOW_BEFORE} caption={<><b>Before the carrier acts, nothing exists in the member's name.</b> Candidates are ranked and refreshed in memory; consent is captured against the outcome. The original ticket stays the member's only live booking until the carrier kills it.</>} />
          <Mermaid chart={FLOW_AFTER} caption={<><b>After the carrier acts, the original segment is dead — so a new booking is no longer a duplicate.</b> Negotiation runs first and entirely in memory, so exactly <em>one</em> booking is ever created. Disposing of the original is still the last step, and it is safe because a cancelled segment was never competing with it.</>} />

          <div className="callout good" style={{ marginTop: '1.4rem', maxWidth: 'var(--measure)' }}>
            <span className="kicker">Why negotiation moved before the hold</span>
            <p>
              We previously held a baseline and negotiated against it — hold the floor, then hunt the
              ceiling. That is now illegal: the baseline and the candidate would be two live bookings
              for the same passenger. So negotiation runs <b>first</b>, over the pre-fetched candidate
              set, in memory, at zero supplier calls and in milliseconds. Then we book <b>once</b>.
            </p>
            <p>
              Which is also why the member&rsquo;s window can be minutes rather than seconds. We do not
              outrun the market by rushing them — at the moment they confirm, and not before, we
              re-check that exact offer with the supplier and cascade to the next candidate if it has
              been sold. Consent was to the outcome, not to one seat.
            </p>
            <p>
              The safety property survives because the exposure window is milliseconds rather than
              the ninety seconds a held baseline would have covered.
            </p>
          </div>
        </section>
      </div>

      <div className="band-alt"><div className="shell">
        <section id="scale">
          <div className="sec-head">
            <span className="sec-num">03</span>
            <span className="kicker">Scalability</span>
            <h2>We do not shard. Here is the arithmetic instead.</h2>
            <p className="prose" style={{ color: 'var(--text-mid)' }}>
              The question is usually posed as “how do you handle a million concurrent users”. Our
              burst target is not a million concurrent anything — it is a real event with a real
              shape, and sizing against it is what keeps the infrastructure honest.
            </p>
          </div>

          <div className="tiles">
            <div className="tile t2"><span className="v"><ProofLink id="burst-rate">1.16/s</ProofLink></span><span className="k">Disruption arrival rate</span><span className="s">3 lakh over 72 h</span></div>
            <div className="tile t2"><span className="v"><ProofLink id="temporal-write-load">~58/s</ProofLink></span><span className="k">Temporal writes</span><span className="s">~1,200/s at 20× burst</span></div>
            <div className="tile t1"><span className="v"><ProofLink id="api-call-collapse">300→102</ProofLink></span><span className="k">API calls, 100 members</span><span className="s">Coordinator collapses the race</span></div>
            <div className="tile t1"><span className="v">~0</span><span className="k">Persistent connections</span><span className="s">FCM push, not sockets</span></div>
          </div>

          <div className="callout good" style={{ marginTop: '1.6rem', maxWidth: 'var(--measure)' }}>
            <span className="kicker">The conclusion the arithmetic forces</span>
            <p>
              A single well-provisioned PostgreSQL absorbs <ProofLink id="temporal-write-load">~58 writes/s</ProofLink> without
              strain. <b>The database is nowhere near the bottleneck — supplier rate limits are.</b> Every
              instinct toward sharding, connection pooling for a million sockets, and a second task
              queue answers a question we do not have.
            </p>
          </div>

          <h3 style={{ marginTop: '2.4rem' }}>If a judge pushes anyway</h3>
          <div className="tw" style={{ marginTop: '1rem' }}>
            <table>
              <thead><tr><th className="n">#</th><th>Lever</th><th>The specific answer</th></tr></thead>
              <tbody>
                <tr><td className="n">1</td><td>Temporal already shards</td><td>Partitions by <code>workflowID</code> hash. <b><code>numHistoryShards</code> is fixed at cluster creation and cannot be changed</b> without a migration — pick 512 up front.</td></tr>
                <tr><td className="n">2</td><td>Split persistence from visibility</td><td>“Millions of workflow states” is a visibility-query problem, not a core-store one. Elasticsearch or OpenSearch.</td></tr>
                <tr><td className="n">3</td><td>Partition by time, not user</td><td>Access is time-clustered and rows go cold within 72 h. Postgres range partitioning on <code>disruption_date</code>; detach old partitions cheaply.</td></tr>
                <tr><td className="n">4</td><td>Archival is the real lever</td><td>Temporal archival to object storage for closed workflows keeps the hot store small.</td></tr>
                <tr><td className="n">5</td><td>Keep the ledger off the hot path</td><td>The decision ledger is append-only and audit-read — event bus → BigQuery, not competing for writes with the saga.</td></tr>
              </tbody>
            </table>
          </div>

          <h3 style={{ marginTop: '2.4rem' }}>The load that actually binds</h3>
          <p className="prose" style={{ color: 'var(--text-mid)', marginTop: '.8rem' }}>
            Under mass cancellation our members are not independent — they compete for the same
            scarce seats. Naive per-member agents burn <ProofLink id="api-call-collapse">300 calls</ProofLink> where
            the coordinator needs 102, and worse, produce a stampede that costs
            <ProofLink id="sens-portfolio"> 38.63 points</ProofLink> of same-day recovery.
          </p>
          <Mermaid chart={BURST} caption={<><b>Searches and holds are a race you cannot pace. Confirms are a queue you can.</b> The coordinator collapses the race to one call, then meters the ticketing.</>} />
        </section>
      </div></div>

      <div className="shell">
        <section id="feasibility">
          <div className="sec-head">
            <span className="sec-num">04</span>
            <span className="kicker">Feasibility</span>
            <h2>In this domain the API is the risk</h2>
            <p className="prose" style={{ color: 'var(--text-mid)' }}>
              So every dependency carries an access rating, and we name the ones we cannot get rather
              than quietly omitting them.
            </p>
          </div>
          <div className="tw">
            <table>
              <thead><tr><th>Dependency</th><th>Access</th><th>What we do</th></tr></thead>
              <tbody>
                <tr><td>Frontend · React Native</td><td style={{ color: 'var(--c1)' }}>Open</td><td>—</td></tr>
                <tr><td>Backend · Node.js / TypeScript</td><td style={{ color: 'var(--c1)' }}>Open</td><td>—</td></tr>
                <tr><td>Agent runtime · LangGraph</td><td style={{ color: 'var(--c1)' }}>Open</td><td>—</td></tr>
                <tr><td>Orchestration · Temporal.io</td><td style={{ color: 'var(--c1)' }}>OSS + free tier</td><td>Single orchestrator. No Celery, no second failure model.</td></tr>
                <tr><td>Policy · Open Policy Agent</td><td style={{ color: 'var(--c1)' }}>CNCF, Apache 2.0</td><td>Sidecar, not remote PDP.</td></tr>
                <tr><td><b>Air + hotel · Duffel + LiteAPI</b></td><td style={{ color: 'var(--c1)' }}>FREE sandbox</td><td>Real book <em>and</em> cancel round trip. Key in about a minute. This is what makes the rollback demo real.</td></tr>
                <tr><td><b>Amadeus Self-Service</b></td><td style={{ color: 'var(--c4)' }}>DEAD — 17 Jul 2026</td><td>Portal decommissioned. Build on Sabre, abstract the supplier so no single GDS is load-bearing.</td></tr>
                <tr><td>Agentic GDS · Sabre Dev Studio</td><td style={{ color: 'var(--c3)' }}>Free, self-serve</td><td>Onboarding is our top ask — it is also what lets us measure real <ProofLink id="churn-governance" plain>hold conversion</ProofLink>.</td></tr>
                <tr><td><b>Predictive · Lumo</b></td><td style={{ color: 'var(--c3)' }}>Commercial · mocked</td><td>Integrated behind an adapter shaped to the real API; every response is labelled <code>lumo</code> or <code>mock</code>. Advisory only until back-tested — precision <em>is</em> hold conversion, so we do not hold speculatively until it is measured.</td></tr>
                <tr><td>Third GDS · Travelport</td><td style={{ color: 'var(--c3)' }}>Commercial · synthetic</td><td>Behind the same supplier interface as Duffel and Sabre, flagged non-live so it is never presented as bookable. One GDS does not carry enough inventory to recover a trip from.</td></tr>
                <tr><td>Preferences · Amex MyCa</td><td style={{ color: 'var(--c3)' }}>Select devs · mocked</td><td>Entitlement, cabin and spend cap are read at recovery time and never copied — a local copy drifts from the card.</td></tr>
                <tr><td>Payments · Amex ACE + vPayment</td><td style={{ color: 'var(--c3)' }}>Select devs · mocked</td><td>Contract test behind the mock; real credential path swaps in on access.</td></tr>
                <tr><td>Messaging · FCM v1</td><td style={{ color: 'var(--c1)' }}>Open</td><td>Hybrid notification + data payload at <code>apns-priority: 10</code>, because iOS throttles data-only pushes.</td></tr>
              </tbody>
            </table>
          </div>

          <div className="grid2" style={{ marginTop: '1.6rem' }}>
            <div className="callout">
              <span className="kicker">What ships 7–21 Aug</span>
              <p>
                Working prototype on the free sandboxes. Temporal saga with an <b>induced mid-booking
                failure</b>. Coordinator allocating across a portfolio. OPA decision ledger. Dashboard.
                Exit criterion: a live re-booking, a clean LIFO rollback, and a terminal disposition
                that leaves no orphaned segment.
              </p>
            </div>
            <div className="callout warn">
              <span className="kicker">Our kill criterion</span>
              <p>
                If that build cannot produce a clean rollback on demand, the durability claim is
                unproven and <b>we will say so</b> rather than hide it. Same for the RBI e-mandate
                mapping: unconfirmed by the finale means autopilot ships disabled and we demo the
                assisted tier.
              </p>
            </div>
          </div>
        </section>

        <footer className="sitefoot">
          <span>Team ZKD · IIT Madras</span>
          <span>System design · localhost:5173</span>
          <span>Every figure links to its proof</span>
        </footer>
      </div>

      <style>{`
        .hero { padding: clamp(3rem,9vw,7rem) 0 clamp(2rem,4vw,3rem); display:flex; flex-direction:column; gap:1.3rem; }
        .lede { font-family:var(--f-serif); font-size:clamp(1.05rem,2.2vw,1.5rem); line-height:1.45;
                color:var(--text-mid); max-width:46ch; }
        .pills { display:flex; flex-wrap:wrap; gap:.5rem; }
        ul.bul { margin:0; padding-left:1.15rem; display:flex; flex-direction:column; gap:.45rem;
                 color:var(--text-mid); font-size:.95rem; }
        ul.bul li::marker { color:var(--accent); }
      `}</style>
    </>
  );
}
