'use client';

import Link from 'next/link';
import { useWorld } from '@/components/WorldProvider';
import { days, ddMon } from '@/lib/time';
import { SettingsSkeleton } from '@/components/PageSkeletons';
import { STRATEGY_LABEL } from '@/server/preferences/presets';
import type { OptimizationStrategy } from '@/server/preferences/schema';

const CHOICES = [
  {
    id: 'autopilot' as const,
    title: 'Fix it and tell me after',
    sub: 'Autopilot',
    body:
      'We rebook your flight, hotel and car inside your policy without waking you. You still get a window to stop us before anything is paid for — as long as the fare is guaranteed for, so you are never asked to decide in seconds. We can never spend beyond the plan we showed you.',
    best: 'Most members choose this. It is the only setting that works while you are in the air or asleep.',
  },
  {
    id: 'ask' as const,
    title: 'Ask me first',
    sub: 'Every time',
    body:
      // "hold the seats" was a leftover from the design that had speculative
      // holds in it. Nothing is held — see lib/noHoldsCopy.test.ts.
      'We do all the work — detect it, search, check your policy, line up the seats — then stop and wait for your go-ahead before spending anything of yours.',
    best:
      'If you do not answer and the recovery costs you nothing, we book it anyway rather than leave you stranded — there is no spend to consult you about. If it would cost you money, we stop and hold.',
  },
];

/**
 * The four settings the scorer already understands.
 *
 * The one-line label comes from STRATEGY_LABEL rather than being retyped, so
 * what the member is promised here and what server/pipeline/score.ts actually
 * weighs cannot drift apart. Everything else is member-facing explanation of
 * the same choice.
 */
const STRATEGIES: { id: OptimizationStrategy; title: string; sub: string; body: string }[] = [
  {
    id: 'earliest_arrival',
    title: 'Get me there soonest',
    sub: 'Default',
    body: 'Arrival time outweighs everything else we can trade. If a paid seat lands materially earlier than a free one and stays inside your cap, we take it.',
  },
  {
    id: 'lowest_cost',
    title: 'Keep it cheapest',
    sub: 'Least out of pocket',
    body: 'We lean on what the airline owes you before anything you pay for. Cost can never be the whole story though — an option we cannot actually book is not a bargain, and a much earlier flight still wins.',
  },
  {
    id: 'minimize_layovers',
    title: 'Fewest changes',
    sub: 'Straightest route',
    body: 'A direct beats a connection even when the connection is quicker or cheaper. Worth choosing if you travel with children, checked bags or tight mobility.',
  },
  {
    id: 'stick_to_preferred_airline',
    title: 'Stay on my airline',
    sub: 'Protect status',
    body: 'We prefer carriers you hold status with, so your miles and tier benefits survive the disruption. We will still move you off them rather than leave you stranded.',
  },
];

export default function SettingsPage() {
  const { schedule, setConsent, setStrategy } = useWorld();
  if (!schedule) return <SettingsSkeleton />;

  const activated = days(new Date(), -412);
  const consent = schedule.passenger.consent;
  const strategy = schedule.passenger.strategy;

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
        <div className="kv"><span className="k">Member</span><span className="v">{schedule.passenger.displayName}</span></div>
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

      <div className="sect">What to optimise for</div>
      <p style={{ margin: '0 0 16px', color: 'var(--mist2)', fontSize: 13, maxWidth: '62ch' }}>
        Standing permission decides <em>whether</em> we act. This decides <em>which</em> option we pick
        when we do — we compare every alternative on arrival, cost, how reliably it can actually be
        booked, cabin, your loyalty and how many changes it adds, and this sets what that comparison
        leans on. Your card&apos;s spending limit is not a preference and never moves.
        {strategy === null && ' You have not chosen yet, so we are getting you there soonest.'}
      </p>

      <div className="choices">
        {STRATEGIES.map((s) => {
          const on = strategy === null ? s.id === 'earliest_arrival' : strategy === s.id;
          return (
            <button
              key={s.id}
              className={`g choice ${on ? 'on' : ''}`}
              aria-pressed={on}
              onClick={() => setStrategy(s.id)}
            >
              <span className="mark" aria-hidden />
              <span className="body">
                <span className="hd">
                  <span className="ttl">{s.title}</span>
                  <span className="tag">{s.sub}</span>
                  {on && <span className="tag live">{strategy === null ? 'In effect' : 'Your choice'}</span>}
                </span>
                <span className="p">{s.body}</span>
                <span className="best">We optimise for {STRATEGY_LABEL[s.id]}.</span>
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
