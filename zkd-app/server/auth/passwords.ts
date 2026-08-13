/**
 * Password hashing. `node:crypto` scrypt only — no bcrypt dependency.
 *
 * Seeded hashes are produced at seed time FROM PLAINTEXT CONSTANTS in
 * seed.ts. That is correct for a prototype whose entire store is a
 * module-level Map that dies on restart — it is not how real credential
 * provisioning would work, and should not be copied into a production seed.
 */
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const KEYLEN = 64;

export function hashPassword(plain: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(plain, salt, KEYLEN).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

/** Constant-time. Returns false on any malformed stored value rather than throwing. */
export function verifyPassword(plain: string, stored: string): boolean {
  try {
    const [scheme, salt, hashHex] = stored.split('$');
    if (scheme !== 'scrypt' || !salt || !hashHex) return false;
    const expected = Buffer.from(hashHex, 'hex');
    const actual = scryptSync(plain, salt, KEYLEN);
    if (expected.length !== actual.length) return false;
    return timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

/**
 * A real hash of a throwaway value. Verifying against this on an unknown-email
 * login keeps the response time indistinguishable from "wrong password" —
 * otherwise a fast 401 on unknown emails would let an attacker enumerate
 * accounts by timing alone. Computed once at module load, not per request.
 */
export const DUMMY_HASH = hashPassword('zkd-dummy-not-a-real-account');
