'use client';

import Link from 'next/link';
import { FACTORS } from '@/lib/risk';
import { WARM_TOTAL, DECIDE_TOTAL, ACT_TOTAL, PREAUTH_THRESHOLD, QUIET_WINDOW_SECONDS } from '@/lib/recovery';
import { secs } from '@/lib/time';

const BANDS = [
  { p: '0–24%', cls: 'low', t: 'Watch only', tag: 'silent',
    d: 'We re-score the flight every 10 minutes and do nothing else. Your phone stays quiet.' },
  { p: '25–54%', cls: 'mid', t: 'Start preparing', tag: 'still silent',
    d: 'We assemble your trip, run one search covering everyone on the route, and price the alternatives. Nothing is held and nothing is spent — you are not told, because there is nothing to act on yet.' },
  { p: '55–79%', cls: 'high', t: 'Prepare harder', tag: 'still silent',
    d: 'Everything above, plus we evaluate whether holding a seat is actually worth it, and pre-compute the policy verdict on every candidate so the decision is already made.' },
  { p: `${PREAUTH_THRESHOLD}%+`, cls: 'act', t: 'Come and ask you', tag: 'we notify',
    d: 'Now it is likely enough to be worth your attention. We show you the whole plan and the exact cost, and ask what you would want if it happens — while you still have hours to think.' },
  { p: 'Cancelled', cls: 'act', t: 'Act', tag: 'we notify',
    d: 'The airline files it. If you pre-authorised, we execute immediately. If not, you get 90 seconds.' },
];

export default function HowItWorksPage() {
  const total = FACTORS.reduce((a, f) => a + f.w, 0);

  return (
    <div className="skeleton">
      <div className="page-h">
        <h1>How the prediction works</h1>
        <p>
          What the number on your flight actually means, where it comes from, and — more
          importantly — what we do differently at each level.
        </p>
      </div>
      <div className="sect">The one thing to understand</div>
      <div className="g panel" style={{ marginBottom: 16, borderColor: 'rgba(47,127,240,.3)' }}>
        <p style={{ margin: 0, fontSize: 15, lineHeight: 1.7, color: 'var(--mist)' }}>
          <b style={{ color: 'var(--text)' }}>The prediction does not decide whether you get rebooked.</b>{' '}
          A cancellation is a fact the airline files — we do not need to guess it to act on it. The
          model exists to buy <b style={{ color: 'var(--text)' }}>time</b>: when it flags a flight, we
          do {secs(WARM_TOTAL)} of work in advance, so that when the cancellation lands we need about{' '}
          {secs(DECIDE_TOTAL + ACT_TOTAL)} instead of {secs(WARM_TOTAL + DECIDE_TOTAL + ACT_TOTAL)}.
        </p>
        <div className="kv" style={{ marginTop: 18 }}>
          <span className="k">If we cry wolf and the flight operates</span>
          <span className="v ok">costs an API call · you never know</span>
        </div>
        <div className="kv">
          <span className="k">If we miss one and it cancels</span>
          <span className="v ok">recovery takes {secs(WARM_TOTAL + DECIDE_TOTAL + ACT_TOTAL)} instead of {secs(DECIDE_TOTAL + ACT_TOTAL)}</span>
        </div>
        <div className="kv">
          <span className="k">Either way, are you stranded?</span>
          <span className="v ok">no</span>
        </div>
        <p className="why">
          That is why an imperfect model is safe to run. Your safety does not rest on the
          prediction — it rests on the fact that nothing irreversible happens until the airline
          actually cancels and you have had your say.
        </p>
      </div>

      <div className="sect">What goes into the number</div>
      <div className="g panel" style={{ marginBottom: 16 }}>
        <h3>Five signals, weighted</h3>
        {FACTORS.map((f) => (
          <div className="wt" key={f.id}>
            <span className="nm">{f.name}</span>
            <span className="bar"><i style={{ width: `${(f.w / 34) * 100}%` }} /></span>
            <span className="pc">{f.w}%</span>
          </div>
        ))}
        <p className="why">
          Each signal is scored 0–1 for how bad it currently is, multiplied by its weight, and the
          five are added up. Weather dominates because in Indian domestic aviation it is the single
          largest cause of cancellation. Your aircraft&apos;s inbound flight is second because a late
          inbound on a tight turn is how a cancellation is <em>made</em>, not merely forecast.
        </p>
        <div className="kv" style={{ marginTop: 6 }}>
          <span className="k">Weights add up to</span><span className="v">{total}%</span>
        </div>
        <div className="kv">
          <span className="k">Shown on every flight as</span>
          <span className="v">the five bars under &ldquo;what&apos;s driving it&rdquo;</span>
        </div>
      </div>

      <div className="sect">What we do at each level</div>
      {BANDS.map((b) => (
        <div className={`hiw-band ${b.cls}`} key={b.p}>
          <span className="p">{b.p}</span>
          <span className="w"><b>{b.t}</b><span>{b.d}</span></span>
          <span className="tag">{b.tag}</span>
        </div>
      ))}

      <div className="g panel" style={{ marginTop: 16 }}>
        <h3>Why we stay quiet below {PREAUTH_THRESHOLD}%</h3>
        <p style={{ margin: 0, color: 'var(--mist)', fontSize: 13.5, lineHeight: 1.65 }}>
          A probability is not something you can act on. An app that pings you every time a flight
          looks 60% shaky gets muted — and a muted app cannot help you at all. So below{' '}
          {PREAUTH_THRESHOLD}% we do the work silently. Above it, the question changes from
          <em> &ldquo;your flight is cancelled&rdquo;</em> to <em>&ldquo;what would you like if it
          is?&rdquo;</em> — and that is worth asking, because you have hours to answer instead of{' '}
          {QUIET_WINDOW_SECONDS} seconds.
        </p>
      </div>

      <div className="sect">Being honest about it</div>
      <div className="g panel">
        <h3>What this model is not</h3>
        <div className="kv">
          <span className="k">Trained on historical data</span>
          <span className="v warn">not yet — this is a transparent weighted model</span>
        </div>
        <div className="kv">
          <span className="k">Predicting diversions or turn-backs</span>
          <span className="v warn">no — cancellations only</span>
        </div>
        <div className="kv">
          <span className="k">Accounting for one closure cancelling a whole airport</span>
          <span className="v warn">approximated, not modelled properly</span>
        </div>
        <p className="why">
          The production model is gradient-boosted trees over the same five families, calibrated so
          that flights we call 70% cancel about 70% of the time. Until it has enough history to be
          trained honestly, we show the transparent version — and say so.
        </p>
        <p style={{ margin: '16px 0 0' }}>
          <Link href="/flights" className="back" style={{ margin: 0 }}>← Back to my flights</Link>
        </p>
      </div>
    </div>
  );
}
