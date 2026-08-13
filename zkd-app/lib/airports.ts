/**
 * Client-safe airport helpers.
 *
 * The full directory (6,072 airports with country and timezone, ~430 KB) lives
 * in server/airportDirectory.ts and stays there — shipping it to the browser to
 * render a city name would be absurd. Pages pass IATA codes; the server
 * resolves them.
 *
 * What remains here is formatting the UI genuinely needs client-side.
 */

export function routeLabel(from: string, to: string): string {
  return `${from} → ${to}`;
}

/** Money with its currency attached, because a bare number assumes one country. */
export function formatMoney(amount: number, currency: string): string {
  if (!amount) return currency === 'INR' ? '₹0' : `${currency} 0`;
  try {
    return new Intl.NumberFormat(currency === 'INR' ? 'en-IN' : 'en-GB', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${currency} ${Math.round(amount).toLocaleString()}`;
  }
}
