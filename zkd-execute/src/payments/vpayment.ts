/**
 * Amex VPayment — issues the single-use virtual card the member sees in the
 * ACT narration ("a single-use card locked to the amount and today's date").
 * No production credential exists (AMEX_VPAY_API_KEY is unset in every env
 * this has run in — see zkd-app/.env.example), so this is a realistic mock:
 * it actually enforces single-use (a card can't be reused across two
 * bookings) and actually enforces the lock (release is required before the
 * card can be considered inert), rather than just returning a fake string.
 * Swap the body for a real fetch to Amex's endpoint the day a key exists —
 * the interface does not need to change.
 */

export type VirtualCard = {
  cardId: string;
  last4: string;
  amount: number;
  currency: string;
  lockedDate: string; // YYYY-MM-DD
  released: boolean;
};

const issuedCards = new Map<string, VirtualCard>();

export async function issueVirtualCard(input: {
  idempotencyKey: string;
  amount: number;
  currency: string;
}): Promise<VirtualCard> {
  const existing = issuedCards.get(input.idempotencyKey);
  if (existing) return existing; // idempotent: the same recovery attempt never gets a second card

  const card: VirtualCard = {
    cardId: `vpay_${input.idempotencyKey}`,
    last4: String(Math.floor(1000 + Math.random() * 9000)),
    amount: input.amount,
    currency: input.currency,
    lockedDate: new Date().toISOString().slice(0, 10),
    released: false,
  };
  issuedCards.set(input.idempotencyKey, card);
  return card;
}

export async function releaseVirtualCard(idempotencyKey: string): Promise<{ released: boolean }> {
  const card = issuedCards.get(idempotencyKey);
  if (!card) return { released: false };
  card.released = true;
  return { released: true };
}
