/**
 * Executable checks for the Makcorps affordability guard.
 *
 * `marketExceedsTolerance` is one comparison, which is exactly the shape of
 * bug that survives review: a `>=` where `>` was meant, a tolerance applied to
 * the wrong operand, a currency check silently dropped. The stakes here are
 * asymmetric — vetoing too eagerly means the agent refuses to even search a
 * city because a scraped price for some arbitrary future date looked
 * expensive, which is worse than the guard doing nothing at all.
 *
 * Run:  npm run verify:hotels
 */

import { marketExceedsTolerance } from './tolerance.ts';

let failures = 0;

function check(name: string, ok: boolean, detail = '') {
  if (ok) console.log(`  ok    ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const CAP = { amount: 10_000, currency: 'INR' };

console.log('\nWithin tolerance never vetoes');
{
  check('at the cap', !marketExceedsTolerance(10_000, 'INR', CAP));
  check('2x the cap — plausible peak pricing, must not block a real search',
    !marketExceedsTolerance(20_000, 'INR', CAP));
  check('exactly 3x — the boundary itself does not trip it', !marketExceedsTolerance(30_000, 'INR', CAP));
}

console.log('\nOnly genuinely implausible markets veto');
{
  check('3x + 1 does trip it', marketExceedsTolerance(30_001, 'INR', CAP));
  check('10x definitely trips it', marketExceedsTolerance(100_000, 'INR', CAP));
}

console.log('\nCurrency mismatch never vetoes — no invented FX rate');
{
  check('a USD median against an INR cap is not compared', !marketExceedsTolerance(100_000, 'USD', CAP));
}

console.log(failures === 0 ? '\nAll hotel guard checks passed.\n' : `\n${failures} CHECK(S) FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
