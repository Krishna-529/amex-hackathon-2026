/**
 * MyCa — the Amex card member app, and the system of record for who the member
 * is, what they are entitled to, and how they pay. The concierge stores none of
 * it: it reads what it needs at recovery time and holds nothing afterwards.
 *
 * That matters beyond tidiness. Ranking a replacement flight means knowing the
 * cabin the member is entitled to and the cap on a single transaction — if we
 * kept our own copy it would drift from the card, and we would rank against
 * entitlements the member no longer has.
 *
 * No credentials exist yet, so this returns a mock and says `source: 'mock'`.
 *
 * OPEN, and deliberately not guessed at: what happens when the card member books
 * for someone else. Today `traveller` and `cardMember` are the same person here.
 * The types below keep them separate so the answer can be dropped in without a
 * rewrite, but the consent rules for that case are a question for the mentor.
 */

export type CabinClass = 'Economy' | 'Premium Economy' | 'Business' | 'First';

export type TravelPreferences = {
  seat: string;
  meal: string;
  cabinEntitlement: CabinClass;
  preferredCarriers: string[];
  /** the member will not be auto-booked past this on one transaction */
  perTransactionCap: { amount: number; currency: string };
  /** avoid overnight arrivals, red-eyes, etc. — ranking hints, never hard rules */
  avoidRedEye: boolean;
};

export type PaymentInstrument = {
  /** display only — never a PAN, and never anything the agent could reuse */
  display: string;
  /** single-use virtual card, locked to an amount and a date at issue time */
  method: 'vpayment-single-use';
  billingCurrency: string;
};

export type CardMember = {
  legalName: string;
  displayName: string;
  dob: string;
  gender: string;
  nationality: string;
  passport: { number: string; expiry: string; issued: string };
  contact: { email: string; phone: string };
  loyalty: { airline: string; number: string; tier: string }[];
};

export type MycaProfile = {
  cardMember: CardMember;
  /** who is actually flying. Same person as the card member until we learn otherwise. */
  traveller: CardMember;
  travellerIsCardMember: boolean;
  preferences: TravelPreferences;
  payment: PaymentInstrument;
  /** which card product's benefit terms apply, for the entitlement bundle */
  cardProduct: string;
  source: 'myca' | 'mock';
};

export async function fetchProfile(memberId: string): Promise<MycaProfile> {
  const key = process.env.MYCA_API_KEY;
  if (!key) return mockProfile();

  try {
    const res = await fetch(`https://api.myca.americanexpress.com/v1/members/${encodeURIComponent(memberId)}/travel-profile`, {
      headers: { Authorization: `Bearer ${key}` },
      cache: 'no-store',
    });
    if (!res.ok) return mockProfile();
    const json = (await res.json()) as Partial<MycaProfile>;
    if (!json.cardMember || !json.preferences || !json.payment) return mockProfile();
    return { ...json, source: 'myca' } as MycaProfile;
  } catch {
    return mockProfile();
  }
}

function mockProfile(): MycaProfile {
  const member: CardMember = {
    legalName: 'PRIYA RAMESH SUNDARAM',
    displayName: 'Priya S.',
    dob: '14 Mar 1988',
    gender: 'Female',
    nationality: 'Indian',
    passport: { number: 'Z••••••21', expiry: 'Sep 2031', issued: 'India' },
    contact: { email: 'p.sundaram@•••••.com', phone: '+91 ••••• 4471' },
    loyalty: [
      { airline: 'Air India · Maharaja Club', number: 'AI••••8802', tier: 'Gold' },
      { airline: 'IndiGo · 6E Rewards', number: '6E••••1173', tier: '—' },
    ],
  };

  return {
    cardMember: member,
    traveller: member,
    travellerIsCardMember: true,
    preferences: {
      seat: 'Aisle, forward cabin',
      meal: 'Vegetarian (AVML)',
      cabinEntitlement: 'Economy',
      preferredCarriers: ['AI', '6E'],
      perTransactionCap: { amount: 25000, currency: 'INR' },
      avoidRedEye: true,
    },
    payment: {
      display: 'Amex Platinum ••••  ••••  ••••  1008',
      method: 'vpayment-single-use',
      billingCurrency: 'INR',
    },
    cardProduct: 'Amex Platinum',
    source: 'mock',
  };
}

/** What we will not hold, stated as data so the UI cannot drift from the policy. */
export const NEVER_STORED = [
  'We never store your CVV or full card number',
  'We never share your passport with anyone but the operating airline',
  'We never hold payment credentials the agent can reuse',
  'Your preferences live in MyCa — we read them when something goes wrong, and keep no copy',
];
