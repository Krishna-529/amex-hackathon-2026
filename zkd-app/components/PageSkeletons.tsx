import {
  SkRoot, SkLine, SkBlock, SkText, SkPageHead, SkSect, SkBack, SkPanel,
  SkPlanGroup, SkRouteLine, SkUpcoming, SkHistoryTable, SkTableRows, SkTimeline, SkGauge,
} from './Skeletons';

/**
 * Whole-page skeletons, one per route.
 *
 * Each of these has TWO callers and must stay identical for both:
 *
 *   1. the route's own `loading.tsx`, which React shows while the route
 *      segment is being fetched/compiled — i.e. between the click on a nav
 *      tab and the page component existing at all; and
 *   2. the page component's own loading guard, which covers the gap after
 *      that, while its client-side polling fetches the member's data.
 *
 * Those are two different waits back to back, and sharing one shape means the
 * handover between them is invisible — no second layout jump halfway through.
 *
 * Deliberately NOT a client component: `loading.tsx` is a Server Component,
 * and everything here is pure JSX with no hooks, so it renders in both.
 *
 * Theme comes from the wrapper each function renders — `.amex-page` for the
 * light Amex routes, nothing for the dark glass routes — and the `--sk-*`
 * custom properties do the rest. See the skeleton section of globals.css.
 */

/* ══════════════ light Amex routes ══════════════ */

function SkField({ label = '4em', w }: { label?: string; w?: number | string }) {
  return (
    <div className="amex-field" style={w === undefined ? undefined : { flex: 'none', width: w }}>
      <label><SkLine w={label} /></label>
      <SkBlock h={44} style={{ borderRadius: 8 }} />
    </div>
  );
}

/** `/` — the search hero and the promo row beneath it. */
export function HomeSkeleton() {
  return (
    <div className="amex-page">
      <div className="amex-container">
        <SkRoot label="Loading Amex Travel">
          <div className="amex-hero-wrap">
            <div className="amex-hero-card">
              <h1><SkLine w="19ch" h=".8em" /></h1>

              <div className="amex-service-tabs">
                {['6.5em', '6em', '10em', '4.5em', '6em'].map((w) => (
                  <span key={w} className="amex-tab-pill" style={{ pointerEvents: 'none' }}>
                    <SkLine w={w} />
                  </span>
                ))}
              </div>

              <div className="amex-form-row">
                <span className="amex-seg">
                  {['5.5em', '4.5em', '5.5em'].map((w) => (
                    <span key={w} className="amex-seg-btn"><SkLine w={w} /></span>
                  ))}
                </span>
                <div style={{ display: 'flex', gap: 12 }}>
                  <SkBlock w={160} h={44} style={{ borderRadius: 8 }} />
                  <SkBlock w={140} h={44} style={{ borderRadius: 8 }} />
                </div>
              </div>

              <div className="amex-field-group">
                <SkField label="3em" />
                <span className="amex-swap-btn" style={{ pointerEvents: 'none' }} />
                <SkField label="2em" />
                <SkField label="4em" />
                <SkBlock w="7.5em" h={44} style={{ borderRadius: 8, flex: 'none' }} />
              </div>
            </div>
          </div>

          <div className="amex-promos">
            <h2><SkLine w="15ch" h=".8em" /></h2>
            <div className="amex-promo-grid">
              {['16em', '13em', '15em'].map((w) => (
                <div className="amex-promo-card" key={w}>
                  <SkBlock h={140} style={{ borderRadius: 0 }} />
                  <div className="amex-promo-body">
                    <h3><SkLine w={w} /></h3>
                    <p><SkText lines={2} last="58%" /></p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </SkRoot>
      </div>
    </div>
  );
}

/** `/login` — the sign-in card and the demo-accounts card under it. */
export function LoginSkeleton() {
  return (
    <div className="amex-page">
      <SkRoot label="Loading sign-in">
        <div className="amex-login-wrap">
          <div className="amex-login-card">
            <h2><SkLine w="17ch" h=".8em" /></h2>
            <p className="sub"><SkText lines={2} last="64%" /></p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <SkField label="10em" />
              <SkField label="5em" />
              <SkBlock h={45} style={{ borderRadius: 8, marginTop: 8 }} />
            </div>
          </div>
          <div className="amex-login-card">
            <h3 style={{ fontSize: 20, margin: '0 0 12px' }}><SkLine w="8em" h=".8em" /></h3>
            {['9em', '11em', '8em'].map((w) => (
              <div className="kv" key={w} style={{ borderTop: '1px solid var(--amex-border)', padding: '10px 0' }}>
                <span className="k"><SkLine w={w} /></span>
                <span className="v"><SkLine w="12em" /></span>
              </div>
            ))}
            <p className="why" style={{ fontSize: 12, marginTop: 12 }}><SkText lines={3} last="42%" /></p>
          </div>
        </div>
      </SkRoot>
    </div>
  );
}

/** `/flights` — head, the upcoming list with its prediction panel, recent history. */
export function FlightsSkeleton() {
  return (
    <div className="amex-page">
      <div className="amex-container">
        <SkRoot label="Loading your flights">
          <SkPageHead w="10ch" />
          <SkSect w="7em" />
          <SkUpcoming rows={3} />
          <SkSect w="10em" />
          <SkHistoryTable rows={4} />
        </SkRoot>
      </div>
    </div>
  );
}

/* ══════════════ dark glass routes ══════════════ */

/** `/flights/[id]` — back link, title, and the route strip: everything above the split. */
function FlightHeadSkeleton() {
  return (
    <>
      <SkBack />
      <SkPageHead w="18ch" lines={1} style={{ padding: '0 0 30px' }} />
      <div className="g panel" style={{ marginBottom: 16 }}><SkRouteLine /></div>
    </>
  );
}

const CONTRIB_W = ['12em', '9em', '14em', '10em', '13em', '8em'];

/**
 * Everything below the head on `/flights/[id]`: the gauge, the four panels and
 * the audit surface. Exported on its own because the page reaches this shape
 * in two stages — the head resolves from `schedule`, the body from `detail` —
 * and once the head is real only the body should be replaced.
 *
 * ForecastAudit has no loading guard of its own; this is its placeholder,
 * since it only ever renders once `detail` has landed.
 */
export function RiskBodySkeleton() {
  return (
    <>
      <div className="split">
        <div>
          <SkGauge style={{ marginBottom: 16 }} />
          <SkPanel rows={5} title="17em" why style={{ marginBottom: 16 }} />
          <SkPanel rows={4} title="19em" />
        </div>
        <div>
          <SkPanel rows={4} title="8em" style={{ marginBottom: 16 }} />
          <SkPanel rows={3} title="9em" />
        </div>
      </div>

      <div style={{ marginTop: 16 }}>
        <div className="g panel" style={{ marginBottom: 16 }}>
          <h3><SkLine w="12em" /></h3>
          <SkBlock h={180} style={{ borderRadius: 10 }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontSize: 10 }}>
            <SkLine w="7em" /><SkLine w="7em" /><SkLine w="7em" />
          </div>
        </div>
        <div className="g panel">
          <h3><SkLine w="24em" /></h3>
          <p style={{ margin: '0 0 14px', fontSize: 13.5, lineHeight: 1.6 }}>
            <SkText lines={3} last="72%" />
          </p>
          {CONTRIB_W.map((w, i) => (
            <div key={w} style={{ padding: '5px 0', display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 168, flex: 'none', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3 }}>
                <SkLine w={w} h={11} />
                <SkLine w="4em" h={9.5} />
              </div>
              {/* the real contribution track, empty — not a bar of its own */}
              <div style={{ flex: 1, height: 16, background: 'var(--sk-base)', borderRadius: 3 }} />
              <SkLine w={44} h={10.5} style={{ opacity: i % 2 ? 0.8 : 1 }} />
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

export function FlightDetailSkeleton() {
  return (
    <SkRoot label="Loading your flight">
      <FlightHeadSkeleton />
      <RiskBodySkeleton />
    </SkRoot>
  );
}

/** `/prepare/[id]` — why we're asking, the conditional plan, and the authorisation. */
export function PrepareSkeleton() {
  return (
    <SkRoot label="Loading your plan">
      <SkBack />
      <SkPageHead w="26ch" style={{ padding: '0 0 26px' }} />
      <div className="split">
        <div>
          <SkPanel rows={5} title="14em" why style={{ marginBottom: 16 }} />
          <div className="g panel">
            <h3><SkLine w="17em" /></h3>
            <SkPlanGroup label="4em" items={1} />
            <SkPlanGroup label="8em" items={1} />
            <SkPlanGroup label="10em" items={2} />
            <div className="acts" style={{ marginTop: 16 }}>
              <SkLine w="10em" h={42} style={{ borderRadius: 11 }} />
            </div>
          </div>
        </div>
        <div>
          <SkPanel rows={4} title="16em" why style={{ marginBottom: 16 }} />
          <div className="g panel">
            <h3><SkLine w="14em" /></h3>
            <p style={{ margin: '0 0 14px', fontSize: 13.5, lineHeight: 1.6 }}>
              <SkText lines={3} last="64%" />
            </p>
            <SkBlock h={52} style={{ borderRadius: 14, marginTop: 14 }} />
            <SkBlock h={52} style={{ borderRadius: 14, marginTop: 14 }} />
          </div>
        </div>
      </div>
    </SkRoot>
  );
}

/** `/recovery/[id]` — the two timelines on the left, cost and diff on the right. */
export function RecoverySkeleton() {
  return (
    <SkRoot label="Loading your recovery">
      <SkBack />
      <SkPageHead w="20ch" style={{ padding: '0 0 26px' }} />
      <div className="split">
        <div>
          <div className="g flow" style={{ marginBottom: 16 }}>
            <h3><SkLine w="14em" /></h3>
            <p className="phase-note"><SkText lines={2} last="86%" /></p>
            <SkTimeline steps={3} />
          </div>
          <div className="g flow">
            <h3><SkLine w="16em" /></h3>
            <p className="phase-note"><SkText lines={2} last="58%" /></p>
            <SkTimeline steps={2} />
          </div>
        </div>
        <div>
          <SkPanel rows={3} title="11em" style={{ marginBottom: 16 }} />
          <SkPanel rows={5} title="10em" />
        </div>
      </div>
    </SkRoot>
  );
}

/** `/profile` — identity and document panels left, bookings and payment right. */
export function ProfileSkeleton() {
  return (
    <SkRoot label="Loading your details">
      <SkBack />
      <SkPageHead w="14ch" style={{ padding: '0 0 30px' }} />
      <div className="split">
        <div>
          <SkPanel rows={4} title="17em" why style={{ marginBottom: 16 }} />
          <SkPanel rows={3} title="11em" why style={{ marginBottom: 16 }} />
          <SkPanel rows={2} title="15em" why style={{ marginBottom: 16 }} />
          <SkPanel rows={2} title="9em" why />
        </div>
        <div>
          <div className="g panel" style={{ marginBottom: 16 }}>
            <h3><SkLine w="9em" /></h3>
            {[0, 1, 2].map((i) => (
              <div className="bk" key={i}>
                <div className="bk-h">
                  <span className="fc"><SkLine w="4.5em" /></span>
                  <span className="rt"><SkLine w="9em" /></span>
                  <span className="pnr"><SkLine w="4.5em" /></span>
                </div>
                <div className="bk-m"><SkLine w="17em" /></div>
              </div>
            ))}
          </div>
          <SkPanel rows={4} title="12em" style={{ marginBottom: 16 }} />
          <SkPanel rows={2} title="7em" why style={{ marginBottom: 16 }} />
          <SkPanel rows={3} title="13em" />
        </div>
      </div>
    </SkRoot>
  );
}

/** `/settings` — the card panel, the two standing-permission choices, the guarantees. */
export function SettingsSkeleton() {
  return (
    <SkRoot label="Loading your card and permissions">
      <SkBack />
      <SkPageHead w="24ch" style={{ padding: '0 0 30px' }} />
      <SkPanel rows={4} title="4em" style={{ marginBottom: 16 }} />
      <div className="sect"><SkLine w="13em" /></div>
      <p style={{ margin: '0 0 16px', fontSize: 13, maxWidth: '62ch' }}>
        <SkText lines={2} last="70%" />
      </p>
      <div className="choices">
        {[0, 1].map((i) => (
          <div className="g choice" key={i} style={{ pointerEvents: 'none' }}>
            <span className="mark" />
            <span className="body">
              <span className="hd">
                <span className="ttl"><SkLine w="12em" /></span>
                <span className="tag"><SkLine w="5em" /></span>
              </span>
              <span className="p"><SkText lines={4} last="44%" /></span>
              <span className="best"><SkText lines={2} last="58%" /></span>
            </span>
          </div>
        ))}
      </div>
      <SkPanel rows={5} title="13em" style={{ marginTop: 16 }} />
    </SkRoot>
  );
}

/** `/history` — head and the full past-flights table. */
export function HistorySkeleton() {
  return (
    <SkRoot label="Loading your flight history">
      <SkPageHead w="8ch" />
      <SkHistoryTable rows={8} />
    </SkRoot>
  );
}

/**
 * `/ops` — the operator console. Not a member surface, but it still sits under
 * the root segment, so it needs a loading.tsx of its own or it would inherit
 * the light Amex home skeleton from `app/loading.tsx`.
 */
export function OpsSkeleton() {
  return (
    <SkRoot label="Loading the operator console">
      <SkPageHead w="16ch" lines={3} />
      <SkSect w="4em" />
      <div className="g" style={{ overflow: 'hidden', marginBottom: 28 }}>
        <table className="tbl">
          <thead>
            <tr>
              {['4em', '3.5em', '4em', '3em', '6em', '4em', '4em'].map((w, i) => (
                <th key={w} className={i === 6 ? 'ar' : undefined}><SkLine w={w} /></th>
              ))}
            </tr>
          </thead>
          <tbody><SkTableRows cols={7} rows={4} /></tbody>
        </table>
      </div>
      <SkSect w="7em" />
      <div className="g panel" style={{ marginBottom: 28 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
          {[0, 1, 2, 3, 4, 5, 6].map((i) => <SkBlock key={i} h={41} style={{ borderRadius: 11 }} />)}
        </div>
        <div style={{ marginTop: 12 }}>
          <div className="lbl" style={{ marginBottom: 8 }}><SkLine w="12em" /></div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {['7em', '5.5em', '8em', '6em'].map((w) => (
              <span key={w} className="opt" style={{ padding: '7px 14px', width: 'auto', pointerEvents: 'none' }}>
                <SkLine w={w} />
              </span>
            ))}
          </div>
        </div>
        <SkBlock w="8em" h={41} style={{ borderRadius: 11, marginTop: 12 }} />
      </div>
      <SkSect w="10em" />
      <SkPanel rows={3} title="6em" />
    </SkRoot>
  );
}
