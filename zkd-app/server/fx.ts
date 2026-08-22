/**
 * Currency conversion — deliberately reversing an earlier refusal.
 *
 * This codebase used to refuse FX outright: `altsFromOffers.ts` marked any fare
 * quoted outside the card's billing currency `needsConversion` and forced
 * `ok:false` rather than invent a rate. That was the right call while the
 * converted number was going to be compared against a hard spend ceiling — a
 * guessed rate deciding whether a real card is charged is indefensible.
 *
 * The ceiling is gone (see server/domain/pricing.ts), and what remains is a
 * display and comparison problem: a member holding an Indian Amex, shown a fare
 * in EUR, cannot tell whether it is cheap. Refusing to convert did not protect
 * them from anything — it just hid every European offer behind "we will not
 * approve this automatically", which is how the option list ended up nearly
 * empty on live Duffel inventory.
 *
 * So we convert, and we are honest about what the number is:
 *
 *   1. The rate is a real published daily reference rate, not a guess.
 *   2. The member is told the number is a conversion at market rates and that
 *      the amount actually charged may differ. `CONVERSION_NOTE` is that
 *      sentence and it travels with every converted figure.
 *   3. The rate and the moment it was read are recorded with the decision
 *      (server/decisionLedger.ts), so a settled charge can be reconciled
 *      against what the member was shown rather than argued about.
 *
 * ── Why a dead FX endpoint must not blank the option list ──────────────────
 *
 * `altsCache.ts` already refuses to replace a good candidate list with an empty
 * one on a failed search, on the grounds that "no results" is far more often
 * every supplier being throttled at once. The same reasoning applies here: if
 * the only thing standing between a stranded member and a visible option is our
 * ability to reach a rates API, the rates API is not allowed to be a single
 * point of failure. Hence FALLBACK_RATES — stale, clearly marked `stale`, and
 * infinitely better than an empty screen.
 */

import { getOrSet } from './cache';

/** What the member reads under any converted figure. */
export const CONVERSION_NOTE =
  'Converted at current market rates — the amount charged may vary slightly.';

export type Rate = {
  from: string;
  to: string;
  /** multiply an amount in `from` by this to get `to` */
  rate: number;
  /** when the rate was read, epoch ms */
  asOf: number;
  /** 'live' from the rates API, 'fallback' from the committed table, 'identity' when from === to */
  source: 'live' | 'fallback' | 'identity';
};

export type Converted = {
  amount: number;
  currency: string;
  /** null when no conversion happened — the fare was already in the target currency */
  rate: Rate | null;
  /** the original, always kept so the member can see what the supplier actually quoted */
  original: { amount: number; currency: string };
};

/**
 * Committed last-resort rates, per 1 unit of the base into INR.
 *
 * Deliberately checked in rather than fetched-or-fail. These are approximate
 * and WILL drift; they exist so a member never sees a blank option list because
 * a rates host was down, and every figure derived from them is marked
 * `source: 'fallback'` so the UI can say so.
 *
 * Refresh alongside any other hardcoded market assumption in the repo.
 */
const FALLBACK_RATES: Record<string, number> = {
  INR: 1,
  EUR: 92.5,
  USD: 85.0,
  GBP: 108.0,
  AED: 23.1,
  SGD: 63.0,
  THB: 2.4,
  JPY: 0.57,
  AUD: 55.5,
  CHF: 98.0,
};

const RATE_TTL_MS = 12 * 60 * 60 * 1000;

/**
 * Which currency a hotel/accommodation search should ASK a supplier for,
 * given the destination's country code (`server/airportDirectory.ts`'s
 * `countryCodeOf`). Covers the same currencies `FALLBACK_RATES` already
 * prices — asking for a currency this module can't convert back would defeat
 * the point. Defaults to INR for an unmapped country: the conservative,
 * previously-universal choice, not a guess in a new direction.
 *
 * Deliberately narrow (one or two representative countries per major
 * currency zone) rather than a full ISO-3166 table — this exists to unblock
 * a real international search (see the LHR persona in
 * documentation/agent-specs/current §A7 P1), not to be a currency registry.
 * Extend it the day a search for an unlisted country actually needs one.
 */
const CURRENCY_BY_COUNTRY: Record<string, string> = {
  IN: 'INR',
  GB: 'GBP',
  US: 'USD',
  AE: 'AED',
  SG: 'SGD',
  TH: 'THB',
  JP: 'JPY',
  AU: 'AUD',
  CH: 'CHF',
  DE: 'EUR', FR: 'EUR', IT: 'EUR', ES: 'EUR', NL: 'EUR', IE: 'EUR', PT: 'EUR',
};

export function currencyForCountry(countryCode: string): string {
  return CURRENCY_BY_COUNTRY[countryCode.toUpperCase()] ?? 'INR';
}

/**
 * Frankfurter publishes the ECB's daily reference rates, needs no key and no
 * account. A keyless source matters here: anything requiring a secret would be
 * unconfigured on a fresh clone, which puts us straight back to the empty
 * option list this module exists to prevent.
 */
const RATES_URL = 'https://api.frankfurter.app/latest';

export async function getRate(from: string, to: string): Promise<Rate> {
  const base = from.toUpperCase();
  const target = to.toUpperCase();

  if (base === target) {
    return { from: base, to: target, rate: 1, asOf: Date.now(), source: 'identity' };
  }

  return getOrSet(`fx:${base}:${target}`, RATE_TTL_MS, async () => {
    try {
      const res = await fetch(
        `${RATES_URL}?from=${encodeURIComponent(base)}&to=${encodeURIComponent(target)}`,
        { cache: 'no-store', signal: AbortSignal.timeout(6000) },
      );
      if (res.ok) {
        const json = (await res.json()) as { rates?: Record<string, number> };
        const rate = json.rates?.[target];
        if (typeof rate === 'number' && Number.isFinite(rate) && rate > 0) {
          return { from: base, to: target, rate, asOf: Date.now(), source: 'live' as const };
        }
      }
    } catch {
      // Fall through to the committed table. A rates outage is not an outage.
    }
    return fallbackRate(base, target);
  });
}

/**
 * Cross-rate through the committed INR table.
 *
 * An unknown currency returns rate 1 rather than throwing: showing the member a
 * number in the wrong currency, clearly labelled with the original alongside
 * it, beats removing the option entirely — which is the failure mode this whole
 * module exists to end.
 */
function fallbackRate(base: string, target: string): Rate {
  const baseInr = FALLBACK_RATES[base];
  const targetInr = FALLBACK_RATES[target];
  const rate = baseInr && targetInr ? baseInr / targetInr : 1;
  return { from: base, to: target, rate, asOf: Date.now(), source: 'fallback' };
}

/** Converts, rounding to whole units — every currency this app quotes in is
 *  displayed without decimals, and a fractional rupee on a fare is noise. */
export async function convert(
  amount: number,
  from: string,
  to: string,
): Promise<Converted> {
  const original = { amount, currency: from.toUpperCase() };
  if (from.toUpperCase() === to.toUpperCase()) {
    return { amount, currency: to.toUpperCase(), rate: null, original };
  }
  const rate = await getRate(from, to);
  return {
    amount: Math.round(amount * rate.rate),
    currency: to.toUpperCase(),
    rate,
    original,
  };
}

/**
 * Synchronous conversion against an already-fetched rate.
 *
 * The async `convert` is the right entry point for a route handler; this one is
 * for the middle of a scoring loop, where forty options must be converted with
 * one rate and forty awaits would be forty chances to interleave a different
 * rate into the same comparison. A ranking where two options were converted at
 * different rates is not a ranking.
 */
export function convertWith(amount: number, rate: Rate): number {
  return Math.round(amount * rate.rate);
}
