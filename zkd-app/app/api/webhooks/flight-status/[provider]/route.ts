/**
 * The inbound endpoint. One route, many providers.
 *
 * ── Three things this route does differently from every other one here ─────
 *
 * **1. It reads the raw body, not JSON.** `req.text()` rather than `req.json()`,
 * because HMAC verification signs the exact bytes that were sent. Re-serialising
 * parsed JSON changes key order and whitespace and the digest will never match —
 * a bug that presents as "verification mysteriously always fails".
 *
 * **2. It is unauthenticated by session, and authenticated by signature.** Every
 * other API route here goes through `requireSession`. This one cannot: the
 * caller is a machine at Duffel or AeroDataBox that has no cookie. The
 * signature IS the authentication, which is why `server/webhooks/verify.ts` is
 * written with more care than a demo would normally justify — this is the one
 * place a stranger on the internet can make the system believe a flight was
 * cancelled, and a believed cancellation now ends in a charge.
 *
 * **3. It answers before it finishes.** Providers retry on non-2xx and several
 * treat a slow response as a failure, so the work happens after the response is
 * decided. AeroDataBox in particular charges credits when a notification is
 * SENT rather than delivered, so making it retry costs real money.
 *
 * ── Why an unmatched delivery is a 200 ─────────────────────────────────────
 *
 * A delivery naming a flight nobody here has booked is a complete success. Flight
 * numbers get reused across routes and subscriptions are per number, so this is
 * expected traffic, not an error. Returning a failure would make the provider
 * retry forever and make a perfectly healthy feed look broken on their dashboard.
 * Only two things earn a non-2xx: we could not verify who sent it, and we could
 * not parse what they sent.
 */
import { NextRequest, NextResponse } from 'next/server';
import { adapterFor, handleDelivery } from '@/server/webhooks';

export async function POST(req: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;

  const adapter = adapterFor(provider);
  if (!adapter) {
    return NextResponse.json({ error: `unknown provider "${provider}"` }, { status: 404 });
  }

  const rawBody = await req.text();

  const verified = adapter.verify(rawBody, req.headers);
  if (!verified.ok) {
    // Logged server-side with the reason, but the reason is NOT returned: a
    // caller who cannot authenticate does not get to learn whether the secret
    // is unset, the timestamp was stale, or the digest was wrong.
    console.warn(`[webhook:${provider}] rejected — ${verified.reason}`);
    return NextResponse.json({ error: 'unauthorised' }, { status: 401 });
  }

  const result = await handleDelivery(provider, rawBody, req.headers);

  if (!result.ok) {
    console.warn(`[webhook:${provider}] could not process — ${result.detail}`);
    return NextResponse.json({ error: result.detail }, { status: 400 });
  }

  if (result.matched) {
    console.log(`[webhook:${provider}] ${result.detail}`);
  }

  return NextResponse.json({
    received: true,
    matched: result.matched,
    duplicate: result.duplicate,
    detail: result.detail,
  });
}

/**
 * Several providers verify an endpoint with a GET before they will register a
 * subscription against it. Answering plainly — and without leaking whether any
 * secret is configured — is enough for every one of them.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  if (!adapterFor(provider)) {
    return NextResponse.json({ error: `unknown provider "${provider}"` }, { status: 404 });
  }
  return NextResponse.json({ ok: true, provider });
}
