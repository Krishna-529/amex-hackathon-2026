'use client';

import Link from 'next/link';
import { useWorld } from '@/components/WorldProvider';
import { days, ddMon } from '@/lib/time';

const CHOICES = [
  {
    id: 'autopilot' as const,
    title: 'Fix it and tell me after',
    sub: 'Autopilot',
    body:
      'We rebook your flight, hotel and car inside your policy without waking you. You still get 90 seconds to stop us before anything is paid for, and we can never spend beyond the plan we showed you.',
    best: 'Most members choose this. It is the only setting that works while you are in the air or asleep.',
  },
  {
    id: 'ask' as const,
    title: 'Ask me first',
    sub: 'Every time',
    body:
      'We do all the work — detect it, search, check your policy, hold the seats — then stop and wait for your go-ahead before spending anything of yours.',
    best:
      'If you do not answer and the recovery costs you nothing, we book it anyway rather than leave you stranded — there is no spend to consult you about. If it would cost you money, we stop and hold.',
  },
];

export default function SettingsPage() {
  const { world, consent, setConsent } = useWorld();
  if (!world) return <div className="page-h"><h1>Your card</h1></div>;

  const activated = days(world.now, -412);

  return (
    <div className="skeleton">
      <Link href="/flights" className="back">← All flights</Link>

      <div className="page-h" style={{ padding: '0 0 30px' }}>
        <h1>Your card &amp; permissions</h1>
        <p>
          What you told us to do when a trip breaks. You were asked this once, when you activated your
          card — it applies to every trip after that.
        </p>
      </div>
      <div className="g panel" style={{ marginBottom: 16 }}>
        <h3>Card</h3>
        <div className="kv"><span className="k">Product</span><span className="v">Platinum Travel</span></div>
        <div className="kv"><span className="k">Member</span><span className="v">Priya S.</span></div>
        <div className="kv">
          <span className="k">Activated</span>
          <span className="v">{ddMon(activated)} {activated.getFullYear()}</span>
        </div>
        <div className="kv">
          <span className="k">Disruption cover</span>
          <span className="v ok">included</span>
        </div>
      </div>

      <div className="sect">Standing permission</div>
      <p style={{ margin: '0 0 16px', color: 'var(--mist2)', fontSize: 13, maxWidth: '62ch' }}>
        Asked at activation so that when a flight is cancelled at 04:00 nobody has to make a decision.
        Changing it here applies from your next disruption.
      </p>

      <div className="choices">
        {CHOICES.map((c) => {
          const on = consent === c.id;
          return (
            <button
              key={c.id}
              className={`g choice ${on ? 'on' : ''}`}
              aria-pressed={on}
              onClick={() => setConsent(c.id)}
            >
              <span className="mark" aria-hidden />
              <span className="body">
                <span className="hd">
                  <span className="ttl">{c.title}</span>
                  <span className="tag">{c.sub}</span>
                  {on && <span className="tag live">Your choice</span>}
                </span>
                <span className="p">{c.body}</span>
                <span className="best">{c.best}</span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="g panel" style={{ marginTop: 16 }}>
        <h3>What never changes</h3>
        <div className="kv">
          <span className="k">We can spend beyond the plan you were shown</span>
          <span className="v ok">never</span>
        </div>
        <div className="kv">
          <span className="k">A flight you rejected can be re-proposed</span>
          <span className="v ok">never</span>
        </div>
        <div className="kv">
          <span className="k">Anything is booked before the airline actually cancels</span>
          <span className="v ok">never</span>
        </div>
        <div className="kv">
          <span className="k">Duty of care is claimed from the airline first</span>
          <span className="v ok">always</span>
        </div>
        <div className="kv">
          <span className="k">You are left stranded because you didn&apos;t answer</span>
          <span className="v ok">never, when the fix is free</span>
        </div>
      </div>
    </div>
  );
}
