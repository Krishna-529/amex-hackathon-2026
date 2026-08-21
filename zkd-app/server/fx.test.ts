import { describe, expect, it } from 'vitest';
import { currencyForCountry, convertWith, type Rate } from './fx';

describe('currencyForCountry', () => {
  it('maps a mapped country to its real currency', () => {
    expect(currencyForCountry('GB')).toBe('GBP');
    expect(currencyForCountry('US')).toBe('USD');
    expect(currencyForCountry('AE')).toBe('AED');
  });

  it('is case-insensitive', () => {
    expect(currencyForCountry('gb')).toBe('GBP');
  });

  it('defaults an unmapped country to INR rather than throwing', () => {
    expect(currencyForCountry('ZZ')).toBe('INR');
    expect(currencyForCountry('')).toBe('INR');
  });

  it('India stays INR — a domestic hotel search is unchanged', () => {
    expect(currencyForCountry('IN')).toBe('INR');
  });
});

describe('convertWith', () => {
  it('applies the given rate and rounds to whole units', () => {
    const rate: Rate = { from: 'GBP', to: 'INR', rate: 108.3, asOf: Date.now(), source: 'live' };
    expect(convertWith(100, rate)).toBe(10830);
  });

  it('rounds a fractional result to the nearest whole unit', () => {
    const rate: Rate = { from: 'EUR', to: 'INR', rate: 92.567, asOf: Date.now(), source: 'fallback' };
    expect(convertWith(1, rate)).toBe(93);
  });
});
