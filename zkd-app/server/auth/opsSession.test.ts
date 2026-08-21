/**
 * `server/auth/*` had zero test coverage before this file, despite being
 * the boundary this session's audit found had a real, critical gap
 * (`/ops` mutation routes and `POST /api/disruptions` checking only "is
 * ANY member signed in" rather than an operator credential). These cover
 * the new opsSession.ts module directly — the sign/verify/expiry contract
 * every `requireOperator` call depends on.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const REAL_KEY = 'a-real-operator-key';

describe('opsSession', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    process.env.OPS_ACCESS_KEY = REAL_KEY;
    delete process.env.OPS_SESSION_SECRET; // exercise the dev fallback path
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  it('verifies the correct key and rejects a wrong one', async () => {
    const { verifyOpsKey } = await import('./opsSession');
    expect(verifyOpsKey(REAL_KEY)).toBe(true);
    expect(verifyOpsKey('wrong-key')).toBe(false);
    expect(verifyOpsKey('')).toBe(false);
  });

  it('rejects any key when OPS_ACCESS_KEY is unset — fails closed, never guessable', async () => {
    delete process.env.OPS_ACCESS_KEY;
    const { verifyOpsKey } = await import('./opsSession');
    expect(verifyOpsKey(REAL_KEY)).toBe(false);
    expect(verifyOpsKey('')).toBe(false);
  });

  it('does not throw on a key of different length than the real one (timingSafeEqual guard)', async () => {
    const { verifyOpsKey } = await import('./opsSession');
    expect(() => verifyOpsKey('short')).not.toThrow();
    expect(() => verifyOpsKey('a-much-much-much-longer-candidate-key')).not.toThrow();
  });

  it('signs a session that verifies successfully', async () => {
    const { signOpsSession, verifyOpsSession } = await import('./opsSession');
    const token = signOpsSession();
    const session = verifyOpsSession(token);
    expect(session).not.toBeNull();
    expect(typeof session?.iat).toBe('number');
  });

  it('rejects a tampered payload', async () => {
    const { signOpsSession, verifyOpsSession } = await import('./opsSession');
    const token = signOpsSession();
    const [payload, sig] = token.split('.');
    const tamperedPayload = Buffer.from(JSON.stringify({ iat: 0 })).toString('base64url');
    expect(verifyOpsSession(`${tamperedPayload}.${sig}`)).toBeNull();
    void payload;
  });

  it('rejects a tampered signature', async () => {
    const { signOpsSession, verifyOpsSession } = await import('./opsSession');
    const token = signOpsSession();
    const [payload] = token.split('.');
    expect(verifyOpsSession(`${payload}.not-a-real-signature`)).toBeNull();
  });

  it('rejects malformed tokens without throwing', async () => {
    const { verifyOpsSession } = await import('./opsSession');
    expect(verifyOpsSession(null)).toBeNull();
    expect(verifyOpsSession(undefined)).toBeNull();
    expect(verifyOpsSession('')).toBeNull();
    expect(verifyOpsSession('not-even-two-parts')).toBeNull();
    expect(verifyOpsSession('a.b.c')).toBeNull();
    expect(verifyOpsSession('not-base64.also-not-base64')).toBeNull();
  });

  it('rejects an expired session', async () => {
    vi.useFakeTimers();
    const { signOpsSession, verifyOpsSession } = await import('./opsSession');
    const token = signOpsSession();
    expect(verifyOpsSession(token)).not.toBeNull();

    vi.advanceTimersByTime(60 * 60 * 8 * 1000 + 1000); // just past the 8h ceiling
    expect(verifyOpsSession(token)).toBeNull();
    vi.useRealTimers();
  });

  it('a session signed with one secret does not verify under a different one', async () => {
    process.env.OPS_SESSION_SECRET = 'secret-a';
    const { signOpsSession } = await import('./opsSession');
    const token = signOpsSession();

    vi.resetModules();
    process.env.OPS_SESSION_SECRET = 'secret-b';
    const { verifyOpsSession } = await import('./opsSession');
    expect(verifyOpsSession(token)).toBeNull();
  });
});
