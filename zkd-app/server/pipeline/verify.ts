/**
 * Executable checks for the option scorer.
 *
 * This file used to be dominated by three guards against a fabricated `fare: 0`
 * option. That option is gone (see server/domain/types.ts's AltKind) and so are
 * the guards. What remains to prove is the set of claims the scorer still
 * makes, and they are the consequential ones:
 *
 *   - hard rules are FILTERS, not penalties — no weighted sum may outvote a
 *     member's stated rule;
 *   - cost is scored against the real spread of prices, so a near-uniform set
 *     of fares correctly stops cost from deciding;
 *   - reliability keeps an unbookable row from winning, whatever the strategy;
 *   - strategy actually changes the answer.
 *
 * Claims that consequential should be executable rather than asserted in a
 * comment.
 *
 * Run:  npm run verify:pipeline
 */

import { applyHardRules, rankAlts, type ScoreContext } from './score.ts';
import { fallbackNote } from './fallbackNote.ts';
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
    displayCurrency: 'INR',
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

console.log('\nCost is scored against the spread actually on the table');
{
  // Two options a hair apart on price. Cost must not be allowed to decide this
  // — under a fixed denominator it could, which is why the denominator is now
  // the real range.
  const early = alt({ id: 'm-1', code: 'AI 500', fare: 6000, partyFare: 6000, arrivesAt: hours(2) });
  const late = alt({ id: 'm-2', code: 'AI 600', fare: 5900, partyFare: 5900, arrivesAt: hours(9) });
  const ranked = rankAlts([early, late], ctxFor([early, late], { rules: rules({ strategy: 'lowest_cost' }) }));
  check('a ₹100 saving does not buy a 7-hour-later arrival',
    ranked[0].alt.id === 'm-1', `winner=${ranked[0].alt.id}`);
}

{
  // A genuinely large price gap SHOULD win under lowest_cost. The point of
  // relative scoring is that it still discriminates when there is something to
  // discriminate on.
  const dear = alt({ id: 'm-1', code: 'AI 500', fare: 42000, partyFare: 42000, arrivesAt: hours(3) });
  const cheap = alt({ id: 'm-2', code: 'AI 600', fare: 4000, partyFare: 4000, arrivesAt: hours(5) });
  const ranked = rankAlts([dear, cheap], ctxFor([dear, cheap], { rules: rules({ strategy: 'lowest_cost' }) }));
  check('a 10x cheaper option two hours later wins under lowest_cost',
    ranked[0].alt.id === 'm-2', `winner=${ranked[0].alt.id}`);
}

{
  // Identical prices: cost contributes nothing and arrival must decide.
  const a1 = alt({ id: 'm-1', code: 'AI 500', fare: 7000, partyFare: 7000, arrivesAt: hours(6) });
  const a2 = alt({ id: 'm-2', code: 'AI 600', fare: 7000, partyFare: 7000, arrivesAt: hours(2) });
  const ranked = rankAlts([a1, a2], ctxFor([a1, a2], { rules: rules({ strategy: 'lowest_cost' }) }));
  check('with equal fares, the earlier arrival wins even under lowest_cost',
    ranked[0].alt.id === 'm-2', `winner=${ranked[0].alt.id}`);
}

console.log('\nAn option outside the card entitlement is filtered, not ranked');
{
  // `ok: false` is the card's policy verdict. It must be a filter: cheaper and
  // earlier must not be able to buy its way past an entitlement.
  const notEntitled = alt({
    id: 'm-1', code: 'AI 900', fare: 1000, partyFare: 1000,
    ok: false, why: 'Business is above the Economy your card entitles you to',
    arrivesAt: hours(2),
  });
  const entitled = alt({ id: 'm-2', code: 'AI 500', fare: 9000, partyFare: 9000, arrivesAt: hours(4) });
  const { kept, removed } = applyHardRules([notEntitled, entitled], ctxFor([notEntitled, entitled]));
  check('the out-of-entitlement option is removed', kept.length === 1 && kept[0].id === 'm-2');
  check('and the reason names the entitlement',
    removed[0]?.rule.includes('entitles you to') === true, removed[0]?.rule);

  for (const strategy of ['lowest_cost', 'earliest_arrival'] as OptimizationStrategy[]) {
    const ranked = rankAlts(kept, ctxFor([notEntitled, entitled], { rules: rules({ strategy }) }));
    check(`${strategy}: it cannot win, because it never reaches the scorer`,
      ranked[0].alt.id === 'm-2', `winner=${ranked[0].alt.id}`);
  }
}

console.log('\nReliability separates two otherwise comparable options');
{
  // Both bookable and both within entitlement, near-identical on price and
  // arrival. The one carrying a real supplier expiry is the one we can confirm.
  const noExpiry = alt({
    id: 'm-1', code: 'AI 900', fare: 7000, partyFare: 7000,
    expiresAt: null, arrivesAt: hours(4),
  });
  const withExpiry = alt({
    id: 'm-2', code: 'AI 500', fare: 7100, partyFare: 7100,
    expiresAt: T0 + 20 * 60_000, arrivesAt: hours(4),
  });
  const ranked = rankAlts([noExpiry, withExpiry], ctxFor([noExpiry, withExpiry]));
  check('the offer with a real expiry wins the tie',
    ranked[0].alt.id === 'm-2', `winner=${ranked[0].alt.id}`);
}

console.log('\nNo option is ever refused for being expensive');
{
  // The per-transaction cap is gone. An eye-wateringly dear option must still
  // survive hard rules — the member is told the price, not denied the seat.
  const dear = alt({ id: 'm-1', code: 'AI 500', fare: 250000, partyFare: 250000, arrivesAt: hours(3) });
  const { kept, removed } = applyHardRules([dear], ctxFor([dear]));
  check('a ₹250,000 option is kept, not filtered', kept.length === 1, `removed=${removed.length}`);
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

console.log('\nfallbackNote never claims a release that did not happen');
{
  // Everything released cleanly — the reassuring blanket line is fine here.
  const clean = fallbackNote('seat was taken', [
    { component: 'authorise', ok: true },
    { component: 'flight', ok: true },
  ]);
  check('clean rollback says everything was released', /has been released/.test(clean), clean);
  check('clean rollback does not tell the member to hold off', !/do not book/.test(clean), clean);

  // This is the exact scenario the reviewer described: flight committed, hotel
  // failed, and compensating the flight itself failed. The double-charge risk
  // is a member reading "nothing has been charged, you're clear" and buying a
  // second ticket while the un-rolled-back flight is still live with the airline.
  const stuck = fallbackNote('hotel sold out', [
    { component: 'authorise', ok: true },
    { component: 'flight', ok: false },
  ]);
  check('a failed compensation is NOT described as released', !/has been released/.test(stuck), stuck);
  check('names which component is stuck', /flight/.test(stuck), stuck);
  check('tells the member explicitly not to self-serve', /do not book/.test(stuck), stuck);
  check('still confirms no charge (that part is true regardless)', /has not been charged|Nothing has been charged/.test(stuck), stuck);

  // Nothing had committed yet (failed on the very first step) — vacuously
  // "everything released" is correct, not a bug in the .every() on [].
  const nothingDone = fallbackNote('seat was taken', []);
  check('no prior commits reads as cleanly released', /has been released/.test(nothingDone), nothingDone);
}

console.log(failures === 0 ? '\nAll scorer checks passed.\n' : `\n${failures} CHECK(S) FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
