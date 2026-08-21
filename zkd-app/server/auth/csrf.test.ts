/**
 * No test existed for csrf.ts on the sibling branch it was ported from —
 * added here since this session's standard is that new security-relevant
 * code (opsSession.ts, journal.ts's transition fix) always ships with
 * regression coverage.
 */
import { describe, it, expect } from 'vitest';
import { isSameOriginRequest } from './csrf';
import { NextRequest } from 'next/server';

function reqWith(headers: Record<string, string>): NextRequest {
  return new NextRequest('https://example.com/api/whatever', { headers });
}

describe('isSameOriginRequest', () => {
  it('allows a request whose Origin matches the Host', () => {
    const req = reqWith({ origin: 'https://members.example.com', host: 'members.example.com' });
    expect(isSameOriginRequest(req)).toBe(true);
  });

  it('rejects a request whose Origin is a different host', () => {
    const req = reqWith({ origin: 'https://evil.example.com', host: 'members.example.com' });
    expect(isSameOriginRequest(req)).toBe(false);
  });

  it('rejects a request whose Origin is the right hostname but a different scheme/port pairing', () => {
    // URL.host includes the port, so http://x:80 vs the real https host with
    // no explicit port are different hosts here — a deliberately strict check.
    const req = reqWith({ origin: 'http://members.example.com:8080', host: 'members.example.com' });
    expect(isSameOriginRequest(req)).toBe(false);
  });

  it('allows a request with no Origin header at all (same-site navigation, some non-browser clients)', () => {
    const req = reqWith({ host: 'members.example.com' });
    expect(isSameOriginRequest(req)).toBe(true);
  });

  it('rejects when Origin is present but Host is missing — fails closed, not open', () => {
    // NextRequest always derives a Host from the URL in practice, but the
    // function must not assume that; a missing host must fail closed.
    const req = reqWith({ origin: 'https://members.example.com' });
    req.headers.delete('host');
    expect(isSameOriginRequest(req)).toBe(false);
  });

  it('rejects a malformed Origin header rather than throwing', () => {
    const req = reqWith({ origin: 'not-a-valid-url', host: 'members.example.com' });
    expect(() => isSameOriginRequest(req)).not.toThrow();
    expect(isSameOriginRequest(req)).toBe(false);
  });
});
