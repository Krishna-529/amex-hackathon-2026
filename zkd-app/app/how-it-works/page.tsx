'use client';

import Link from 'next/link';
import { WARM_TOTAL, DECIDE_TOTAL, ACT_TOTAL } from '@/lib/recovery';
import { WINDOW_FLOOR_SECONDS, WINDOW_CEILING_SECONDS } from '@/lib/confirmWindow';
import { secs } from '@/lib/time';

const BANDS = [
  { p: 'Below', cls: 'low', t: 'Watch only', tag: 'silent',
    d: 'We re-check the forecast and do nothing else. Your phone stays quiet.' },
  { p: 'Prepare', cls: 'mid', t: 'Start preparing', tag: 'still silent',
    d: 'We assemble your trip, run one search covering everyone on the route, and price the alternatives across every supplier we can reach. Nothing is held and nothing is spent — you are not told, because there is nothing to act on yet.' },
  { p: 'Hold gate', cls: 'high', t: 'Prepare harder', tag: 'still silent',
    d: 'Everything above, plus we evaluate whether holding a seat is actually worth it, and pre-compute the policy verdict on every candidate so the decision is already made.' },
  { p: 'Ask early', cls: 'act', t: 'Come and ask you', tag: 'we notify',
    d: 'Now it is likely enough to be worth your attention. We show you the whole plan and the exact cost, and ask what you would want if it happens — while you still have hours to think.' },
  { p: 'Cancelled', cls: 'act', t: 'Act', tag: 'we notify',
    d: 'The airline files it. If you pre-authorised, we execute immediately. If not, you get a window sized to how long the fare is actually guaranteed for.' },
];

export default function HowItWorksPage() {
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
          forecast exists to buy <b style={{ color: 'var(--text)' }}>time</b>: when it flags a flight, we
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
          That is why an imperfect forecast is safe to run. Your safety does not rest on the
          prediction — it rests on the fact that nothing irreversible happens until the airline
          actually cancels and you have had your say.
        </p>
      </div>

      <div className="sect">Where the number comes from</div>
      <div className="g panel" style={{ marginBottom: 16 }}>
        <h3>We buy the forecast rather than building one</h3>
        <p style={{ margin: 0, color: 'var(--mist)', fontSize: 13.5, lineHeight: 1.65 }}>
          Predicting flight disruption is its own industry, trained on far more history than we
          could gather. So the probability on your flight comes from a specialist disruption
          forecaster, which reads weather, air-traffic flow, airport congestion and each
          airline&apos;s own record. What we add is the part nobody else does: actually fixing it.
        </p>
        <div className="kv" style={{ marginTop: 16 }}>
          <span className="k">Forecast</span>
          <span className="v">bought, not built</span>
        </div>
        <div className="kv">
          <span className="k">What it decides</span>
          <span className="v">when we start preparing</span>
        </div>
        <div className="kv">
          <span className="k">What it never decides</span>
          <span className="v ok">whether we spend your money</span>
        </div>
        <p className="why">
          Until the forecast has been checked against what actually happened on our own routes, it
          is advisory. It can move work earlier. It cannot authorise anything.
        </p>
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
        <h3>Those levels are not fixed numbers</h3>
        <p style={{ margin: 0, color: 'var(--mist)', fontSize: 13.5, lineHeight: 1.65 }}>
          The same 60% means different things on different flights. If there are three seats left on
          the whole route and you depart in an hour, waiting for more certainty costs you the seat —
          so we act earlier. If there are forty seats and you fly tomorrow, there is nothing to gain
          by hurrying. The thresholds move with how much is left to move you onto, how close
          departure is, whether a late arrival breaks something that matters, and how confident the
          forecast is in itself.
        </p>
        <p className="why">
          Every flight shows you its own thresholds, and what they were calculated from.
        </p>
      </div>

      <div className="sect">How long you get to answer</div>
      <div className="g panel" style={{ marginBottom: 16 }}>
        <h3>The window is the airline&apos;s promise, not our guess</h3>
        <p style={{ margin: 0, color: 'var(--mist)', fontSize: 13.5, lineHeight: 1.65 }}>
          When a supplier quotes a fare, it guarantees that price until a stated moment. Your window
          to decide is that guarantee, minus the seconds we need to actually book inside it. That is
          why it changes from one disruption to the next — and why we can defend its length instead
          of having picked it.
        </p>
        <div className="kv" style={{ marginTop: 16 }}>
          <span className="k">Shortest window we will ask in</span>
          <span className="v">{Math.round(WINDOW_FLOOR_SECONDS / 60)} minutes</span>
        </div>
        <div className="kv">
          <span className="k">Longest</span>
          <span className="v">{Math.round(WINDOW_CEILING_SECONDS / 60)} minutes</span>
        </div>
        <div className="kv">
          <span className="k">If there is less time than the floor</span>
          <span className="v">we do not ask — your standing permission decides</span>
        </div>
        <p className="why">
          Asking someone to answer in seconds is not really asking. Below the floor the honest thing
          is to act on the permission you already gave, and tell you afterwards.
        </p>
      </div>

      <div className="g panel" style={{ marginBottom: 16 }}>
        <h3>And the seat can still go while you think</h3>
        <p style={{ margin: 0, color: 'var(--mist)', fontSize: 13.5, lineHeight: 1.65 }}>
          It can. We do not solve that by rushing you. The moment you confirm — and not before — we
          re-check that exact seat with the airline. If it has been sold, we move you to the next
          option that keeps your trip together rather than failing and handing the problem back.
          What you agreed to was getting where you were going, not one particular seat number.
        </p>
      </div>

      <div className="sect">Being honest about it</div>
      <div className="g panel">
        <h3>What this is not</h3>
        <div className="kv">
          <span className="k">Checked against our own outcomes</span>
          <span className="v warn">not yet — the forecast is advisory until it is</span>
        </div>
        <div className="kv">
          <span className="k">Predicting diversions or turn-backs</span>
          <span className="v warn">no — cancellations, reschedules and delays only</span>
        </div>
        <div className="kv">
          <span className="k">Accounting for one closure cancelling a whole airport</span>
          <span className="v warn">approximated, not modelled properly</span>
        </div>
        <p className="why">
          We would rather show you a forecast we did not build, and say plainly that we have not yet
          proved it on our own routes, than show you a number we made up and call it a model.
        </p>
        <p style={{ margin: '16px 0 0' }}>
          <Link href="/flights" className="back" style={{ margin: 0 }}>← Back to my flights</Link>
        </p>
      </div>
    </div>
  );
}
