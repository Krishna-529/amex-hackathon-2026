/**
 * The seeded card-member credentials, as plain data with no crypto imports —
 * safe to pull into the client bundle for the login page's "demo accounts"
 * panel. `server/domain/seed.ts` imports this same list and hashes each
 * password at seed time; this file is the single source for both.
 */
export type DemoAccount = { email: string; password: string; passengerId: string; name: string };

export const DEMO_ACCOUNTS: DemoAccount[] = [
  { email: 'priya@zkd.demo', password: 'priya-2026', passengerId: 'p-priya', name: 'Priya S.' },
  { email: 'arjun@zkd.demo', password: 'arjun-2026', passengerId: 'p-arjun', name: 'Arjun M.' },
  { email: 'fatima@zkd.demo', password: 'fatima-2026', passengerId: 'p-fatima', name: 'Fatima S.' },
  { email: 'rohan@zkd.demo', password: 'rohan-2026', passengerId: 'p-rohan', name: 'Rohan V.' },
  { email: 'ananya@zkd.demo', password: 'ananya-2026', passengerId: 'p-ananya', name: 'Ananya I.' },
];
