/**
 * Executable checks for the option scorer.
 *
 * The three guards on the carrier-protected `fare: 0` problem are the load-
 * bearing claims of this design: without them a member who asked for "lowest
 * cost" is handed whatever is free regardless of when it lands, because the
 * airline-owed alternative is zero-rated by construction. Claims that
 * consequential should be executable, not asserted in a comment.
 *
 * Run:  npm run verify:pipeline
 */

import { applyHardRules, rankAlts, type ScoreContext } from './score.ts';
import type { PartyAlt } from '../domain/altsForParty';
import type { Alt, Flight } from '../domain/types';
import type { RebookingRules } from '../preferences/adapt';
import type { OptimizationStrategy } from '../preferences/schema';

let failures = 0;

function check(name: string, ok: boolean, detail = '') {
  if (ok) console.log(`  ok    ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const T0 = Date.UTC(2026, 7, 16, 12, 0, 0);
const hours = (n: number) => T0 + n * 3_600_000;

function alt(over: Partial<PartyAlt> & { id: string; code: string }): PartyAlt {
  return {
    dep: '10:00',
    arr: '13:00',
    departsAt: hours(0),
    arrivesAt: hours(3),
    cabin: 'Economy',
    seats: 9,
    fare: 8000,
    currency: 'INR',
    expiresAt: T0 + 900_000,
    kind: 'market',
    ok: true,
    why: '',
    fitsParty: true,
    partyFare: 8000,
    ...over,
  } as PartyAlt;
}

function flightWith(alts: PartyAlt[]): Flight {
  return {
    id: 'u1',
    code: 'AI 2803',
    from: 'MAA',
    to: 'DEL',
    depISO: new Date(T0).toISOString(),
    durationMin: 160,
    connectionSlackMinutes: null,
    hasHardConstraint: false,
    candidates: { alts: alts as unknown as Alt[], hotels: [], cabs: [], cabLegs: [] },
  } as Flight;
}

function rules(over: Partial<RebookingRules> = {}): RebookingRules {
  return {
    strategy: 'earliest_arrival',
    allowCabinDowngrade: true,
    avoidAirlines: [],
    maxLayovers: 1,
    outOfPocketCap: { amount: 25000, currency: 'INR' },
    groundCap: { amount: 5000, currency: 'INR' },
    hotelTriggerHours: 6,
    rentalCarTriggerHours: 24,
    alertChannels: ['push'],
    homeAirport: 'MAA',
    ...over,
  };
}

function ctxFor(alts: PartyAlt[], over: Partial<ScoreContext> = {}): ScoreContext {
  return {
    flight: flightWith(alts),
    rules: rules(),
    preferredCabin: 'Economy',
    partySize: 1,
    cap: { amount: 25000, currency: 'INR' },
    preferredCarriers: ['AI'],
    hasHardConstraint: false,
    ...over,
  };
}

console.log('\nHard rules are filters, not penalties');
{
  const blocked = alt({ id: 'a1', code: 'SG 101', arrivesAt: hours(1) }); // earliest by far
  const fine = alt({ id: 'a2', code: 'AI 202', arrivesAt: hours(5) });
  const ctx = ctxFor([blocked, fine], { rules: rules({ avoidAirlines: ['SG'] }) });

  const { kept, removed } = applyHardRules([blocked, fine], ctx);
  check('blocked carrier removed even though it arrives first',
    kept.length === 1 && kept[0].id === 'a2', `kept ${kept.map((k) => k.id).join(',')}`);
  check('removal records the rule that caused it',
    removed.length === 1 && removed[0].rule.includes('SG'), removed[0]?.rule);

  const ranked = rankAlts(kept, ctx);
  check('a weighted sum cannot resurrect it', !ranked.some((r) => r.alt.id === 'a1'));
}

console.log('\nNever split a party');
{
  const tooSmall = alt({ id: 'a1', code: 'AI 1', arrivesAt: hours(1), fitsParty: false, seats: 3 });
  const fits = alt({ id: 'a2', code: 'AI 2', arrivesAt: hours(6) });
  const ctx = ctxFor([tooSmall, fits], { partySize: 6 });
  const { kept, removed } = applyHardRules([tooSmall, fits], ctx);
  check('party-of-6 drops a 3-seat option', kept.length === 1 && kept[0].id === 'a2');
  check('reason names the party', removed[0]?.rule.includes('6') === true, removed[0]?.rule);
}

console.log('\nallow_cabin_downgrade:false is a hard filter that can leave nothing');
{
  const economyOnly = alt({ id: 'a1', code: 'AI 1', cabin: 'Economy' });
  const ctx = ctxFor([economyOnly], {
    preferredCabin: 'Business',
    rules: rules({ allowCabinDowngrade: false }),
  });
  const { kept, removed } = applyHardRules([economyOnly], ctx);
  check('economy dropped when the member forbade downgrades', kept.length === 0);
  check('reason names the cabin rule', removed[0]?.rule.includes('Business') === true, removed[0]?.rule);

  const allowed = applyHardRules([economyOnly], ctxFor([economyOnly], {
    preferredCabin: 'Business',
    rules: rules({ allowCabinDowngrade: true }),
  }));
  check('and is kept when downgrades are allowed', allowed.kept.length === 1);
}

console.log('\nGuard 1+2: free does not automatically beat better');
{
  // The carrier-protected option is free but lands 4h later than a paid one
  // that is comfortably inside the cap.
  const free = alt({
    id: 'cp-1', code: 'AI 900', kind: 'carrier-protected', fare: 0, partyFare: 0,
    expiresAt: null, arrivesAt: hours(8),
  });
  const paid = alt({ id: 'm-1', code: 'AI 500', fare: 6000, partyFare: 6000, arrivesAt: hours(4) });

  for (const strategy of ['earliest_arrival', 'minimize_layovers', 'stick_to_preferred_airline'] as OptimizationStrategy[]) {
    const ctx = ctxFor([free, paid], { rules: rules({ strategy }) });
    const ranked = rankAlts([free, paid], ctx);
    check(`${strategy}: the 4h-earlier paid option wins`,
      ranked[0].alt.id === 'm-1', `winner=${ranked[0].alt.id} total=${ranked[0].score.total}`);
  }
}

console.log('\nGuard 3: the override backstops the lopsided cases');
{
  // Constructed so the weighted sum alone gets it WRONG: near-cap fare drags
  // the cost term down far enough that free edges ahead on total, despite
  // landing ten hours later. This is the case Guard 3 exists for.
  const free = alt({
    id: 'cp-1', code: 'AI 900', kind: 'carrier-protected', fare: 0, partyFare: 0,
    expiresAt: null, arrivesAt: hours(12),
  });
  const paid = alt({ id: 'm-1', code: 'AI 500', fare: 24000, partyFare: 24000, arrivesAt: hours(2) });
  const ctx = ctxFor([free, paid], { rules: rules({ strategy: 'lowest_cost' }) });
  const ranked = rankAlts([free, paid], ctx);

  check('a 10h-earlier in-cap option wins despite scoring lower on the sum',
    ranked[0].alt.id === 'm-1', `winner=${ranked[0].alt.id}`);
  check('and says why in the member-facing note',
    ranked[0].score.notes.some((n) => /earlier than the free option/.test(n)),
    ranked[0].score.notes[0]);
}

console.log('\nWhen plain scoring already gets it right, the override stays out of it');
{
  const free = alt({
    id: 'cp-1', code: 'AI 900', kind: 'carrier-protected', fare: 0, partyFare: 0,
    expiresAt: null, arrivesAt: hours(9),
  });
  const paid = alt({ id: 'm-1', code: 'AI 500', fare: 6000, partyFare: 6000, arrivesAt: hours(4) });
  const ranked = rankAlts([free, paid], ctxFor([free, paid], { rules: rules({ strategy: 'lowest_cost' }) }));
  check('the 5h-earlier cheap-enough option wins on the sum alone',
    ranked[0].alt.id === 'm-1', `winner=${ranked[0].alt.id}`);
  check('no override note, because none was needed',
    !ranked[0].score.notes.some((n) => /earlier than the free option/.test(n)));
}

console.log('\nThe override is narrow — it must not justify spending');
{
  // Same money, but only 20 minutes earlier: under the TIE threshold.
  const free = alt({
    id: 'cp-1', code: 'AI 900', kind: 'carrier-protected', fare: 0, partyFare: 0,
    expiresAt: null, arrivesAt: hours(4) + 20 * 60_000,
  });
  const paid = alt({ id: 'm-1', code: 'AI 500', fare: 6000, partyFare: 6000, arrivesAt: hours(4) });
  const ctx = ctxFor([free, paid], { rules: rules({ strategy: 'lowest_cost' }) });
  const ranked = rankAlts([free, paid], ctx);
  check('a marginally-earlier paid option does NOT displace free under lowest_cost',
    ranked[0].alt.id === 'cp-1', `winner=${ranked[0].alt.id}`);
}

{
  // Over cap: the override must not fire however early it is.
  const free = alt({
    id: 'cp-1', code: 'AI 900', kind: 'carrier-protected', fare: 0, partyFare: 0,
    expiresAt: null, arrivesAt: hours(12),
  });
  const pricey = alt({
    id: 'm-1', code: 'AI 500', fare: 90000, partyFare: 90000, arrivesAt: hours(2),
  });
  const ctx = ctxFor([free, pricey], { rules: rules({ strategy: 'lowest_cost' }) });
  const ranked = rankAlts([free, pricey], ctx);
  check('an over-cap option never displaces free, however early',
    ranked[0].alt.id === 'cp-1', `winner=${ranked[0].alt.id}`);
}

console.log('\nStrategy actually changes the ranking');
{
  const fast = alt({ id: 'fast', code: '6E 1', arrivesAt: hours(2), fare: 14000, partyFare: 14000 });
  const cheap = alt({ id: 'cheap', code: '6E 2', arrivesAt: hours(7), fare: 3000, partyFare: 3000 });
  const loyal = alt({ id: 'loyal', code: 'AI 3', arrivesAt: hours(6), fare: 9000, partyFare: 9000 });

  const pick = (s: OptimizationStrategy) =>
    rankAlts([fast, cheap, loyal], ctxFor([fast, cheap, loyal], { rules: rules({ strategy: s }) }))[0].alt.id;

  check('earliest_arrival picks the fastest', pick('earliest_arrival') === 'fast', pick('earliest_arrival'));
  check('lowest_cost picks the cheapest', pick('lowest_cost') === 'cheap', pick('lowest_cost'));
  check('stick_to_preferred_airline picks the AI flight',
    pick('stick_to_preferred_airline') === 'loyal', pick('stick_to_preferred_airline'));
}

console.log('\nUnknown arrival scores neutral, never best');
{
  const known = alt({ id: 'k', code: 'AI 1', arrivesAt: hours(3) });
  const unknown = alt({ id: 'u', code: 'AI 2', arrivesAt: undefined, departsAt: undefined });
  const ctx = ctxFor([known, unknown], { rules: rules({ strategy: 'earliest_arrival' }) });
  const ranked = rankAlts([known, unknown], ctx);
  check('a source with no arrival time does not win on arrival',
    ranked[0].alt.id === 'k', `winner=${ranked[0].alt.id}`);
  check('and says so', ranked.find((r) => r.alt.id === 'u')!.score.notes.some((n) => /not published/.test(n)));
}

console.log(failures === 0 ? '\nAll scorer checks passed.\n' : `\n${failures} CHECK(S) FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
