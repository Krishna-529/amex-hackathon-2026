import Mermaid from '@/components/Mermaid';

const WORKFLOW_1 = `
flowchart TD
    classDef green fill:#e8f3ea,stroke:#3f7a52,color:#2f5c3d
    classDef amber fill:#faf1df,stroke:#b8863a,color:#7a5a22
    classDef maroon fill:#f7e6e6,stroke:#9c3b3b,color:#7a2626
    classDef terminal fill:#f7e6e6,stroke:#9c3b3b,color:#7a2626,stroke-width:2px

    RM["Risk model scores the flight"]:::amber
    BR{"Band rises"}:::amber
    PC["Pre-cache alternatives"]:::amber
    NR["Notify member: risk has risen"]:::amber

    CPF["Carrier push feed"]:::green
    SP["Status poll"]:::green
    MR["Member report"]:::green
    CC["Cancellation confirmed"]:::green
    SFR["Search, filter & rank alternatives"]:::green
    HTP["Hold the top plan"]:::green

    CRT["Create a recovery task per booking"]:::maroon
    PAV{"Pre-auth on file, still valid?"}:::maroon
    SCA{"Standing consent: autopilot?"}:::maroon
    AI["Act immediately"]:::maroon
    RAI["Revalidate, act immediately"]:::maroon
    NCD["Notify: it's cancelled, then the exact plan & deadline"]:::maroon
    MRD{"Member responds before the deadline?"}:::maroon
    AOP["Act on their pick"]:::maroon
    STOP(("Stop — nothing charged")):::terminal
    WMD{"Was that message confirmed delivered?"}:::maroon
    OGR["One grace retry"]:::maroon
    HTH(("Halt to a human")):::terminal
    PHP["Proceed with the held plan"]:::maroon
    BOOK["Book it"]:::maroon
    MN(("Member notified")):::terminal

    RM --> BR
    BR -->|crosses prepare| PC
    BR -->|any crossing| NR
    PC -->|warm cache| SFR
    NR -.->|member may already have pre-authorised| CRT

    CPF --> CC
    SP --> CC
    MR --> CC
    CC --> SFR
    CC --> CRT

    SFR --> HTP
    HTP -->|yes — the plan being acted on| AI

    CRT --> PAV
    PAV -->|yes| AI
    PAV -->|no| SCA
    SCA -->|yes| RAI
    SCA -->|no — ask| NCD
    NCD --> MRD
    MRD -->|approves| AOP
    MRD -->|hands over| STOP
    MRD -->|silence, deadline passes| WMD
    WMD -->|yes| PHP
    WMD -->|no, first miss| OGR
    OGR --> WMD
    WMD -->|still no| HTH

    AI --> BOOK
    RAI --> BOOK
    AOP --> BOOK
    PHP --> BOOK
    BOOK --> MN
`.trim();

const WORKFLOW_2 = `
flowchart TD
    classDef green fill:#e8f3ea,stroke:#3f7a52,color:#2f5c3d
    classDef amber fill:#faf1df,stroke:#b8863a,color:#7a5a22
    classDef maroon fill:#f7e6e6,stroke:#9c3b3b,color:#7a2626
    classDef terminal fill:#f7e6e6,stroke:#9c3b3b,color:#7a2626,stroke-width:2px

    DC["Disruption confirmed"]:::green
    SR["Start a recovery for each booking"]:::green
    MYCA["Load MyCa card profile"]:::green
    RULES["Load the member's own rules"]:::green
    SLI["Search live flight inventory"]:::green
    F3{"Fewer than 3 directs, and layovers allowed?"}:::green
    BHC["Build hub connections"]:::green
    FRE["Filter by rules & card entitlement"]:::green
    RSP["Rank survivors by learned preference"]:::green
    SOT{"Stranded past their own overnight threshold?"}:::green
    SH["Search hotels"]:::green
    SG["Search a ground transfer"]:::green
    FAD["Filter by accessibility & distance rules"]:::green
    CGC["Cap by their own ground-cost rule"]:::green
    HWP["Hold the whole plan — nothing spent yet"]:::green

    NCP["Notify: it's cancelled, and here's the plan"]:::amber
    MRV{"Member reviews"}:::amber
    RPO["Read their prompt as a preference override"]:::amber
    FRA["Filter + rank again — a fresh preview, still unbooked"]:::amber

    PLC["Plan confirmed"]:::maroon
    BOOK2["Book it — flight, then hotel, then ground"]:::maroon
    RB["Roll back what was already booked"]:::maroon
    H2H(("Handed to a human")):::terminal
    MFI(("Member notified with the finished itinerary")):::terminal

    DC --> SR
    SR --> MYCA
    SR --> RULES
    MYCA --> SLI
    RULES --> SLI
    SLI --> F3
    F3 -->|yes| BHC
    F3 -->|no| FRE
    BHC --> FRE
    FRE --> RSP
    RSP --> SOT
    SOT -->|yes| SH
    SOT -->|yes| SG
    SOT -->|no| HWP
    SH --> FAD
    SG --> CGC
    FAD --> HWP
    CGC --> HWP

    HWP --> NCP
    NCP --> MRV
    MRV -->|types what they'd rather have| RPO
    RPO --> FRA
    FRA --> MRV
    MRV -->|approves directly| PLC
    MRV -->|silence, deadline passes, delivery confirmed| PLC
    MRV -->|autopilot, or pre-authorised in advance| PLC

    PLC --> BOOK2
    BOOK2 -->|a critical step fails| RB
    BOOK2 -->|every critical step succeeds| MFI
    RB --> H2H
`.trim();

export default function Page() {
  return (
    <main className="page">
      <span className="eyebrow">ZKD Concierge — as implemented, origin/main</span>
      <h1>Two workflows: the app, and the rebooking component</h1>
      <p className="lede">
        Traced directly from source, main features only — 1) the app&apos;s overall arc from a
        rising cancellation risk to a finished rebooking, and 2) everything the rebooking
        component itself does, from trigger to a confirmed itinerary.
      </p>

      <div className="legend">
        <span className="chip green">Reversible — searching, ranking, holding; nothing spent</span>
        <span className="chip amber">Member-facing — a decision or a notification</span>
        <span className="chip maroon">Irreversible — real money moves</span>
      </div>

      <section className="workflow">
        <div className="workflow-header">
          <span className="workflow-num">01</span>
          <h2>Workflow 1 — prediction to booked</h2>
        </div>
        <p className="workflow-desc">
          Small single-purpose steps, loop-backs, two branches converging on one booking step —
          every label is what the code actually does.
        </p>
        <div className="diagram">
          <Mermaid chart={WORKFLOW_1} />
        </div>
        <div className="footnote">
          <b>Amber:</b> risk escalation, off the critical path. <b>Green:</b> detection and
          reversible planning. <b>Maroon:</b> the actual consent decision — pre-auth, autopilot,
          or a member with a real deadline and a delivery-confirmed silence-then-proceed rule,
          never an assumed one.
        </div>
      </section>

      <section className="workflow">
        <div className="workflow-header">
          <span className="workflow-num">02</span>
          <h2>Workflow 2 — the rebooking component, in full</h2>
        </div>
        <p className="workflow-desc">
          Small single-purpose steps rather than a few boxes doing five things each — including
          the failure path an earlier draft left out entirely.
        </p>
        <div className="diagram">
          <Mermaid chart={WORKFLOW_2} />
        </div>
        <div className="footnote">
          <b>On the prompt:</b> typing a sentence never books anything by itself — that route is
          explicitly read-only in the code. It re-runs the same filter-and-rank against a
          validated override and shows the member a fresh preview. What actually books is still
          their confirmation: approve, a delivery-confirmed silence past a real deadline, or a
          standing autopilot / pre-auth permission set up in advance.
        </div>
      </section>

      <div className="source">zkd-app/server · zkd-app/app/api · traced file-by-file, origin/main — no functionality inferred or assumed</div>
    </main>
  );
}
