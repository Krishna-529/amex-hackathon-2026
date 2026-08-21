/**
 * "This flight was cancelled" — the member as a detection source.
 *
 * The split this route exists to enforce: a report always starts the
 * REPORTER's own recovery, and only starts everyone else's once corroborated.
 * See server/engine/memberReports.ts for why the asymmetry is drawn there
 * rather than trusting a caller to remember it.
 *
 * A member with no booking on this flight cannot report it. That is not a
 * permissions formality — it is the cheapest possible spam filter, and it means
 * every report in the ledger comes from somebody with something at stake.
 */
import { NextRequest, NextResponse } from 'next/server';
import * as store from '@/server/domain/store';
import { requireSession } from '@/server/auth/guard';
import { report, hasReported, INDEPENDENT_REPORTS_NEEDED } from '@/server/engine/memberReports';
import { detectDisruption, widenDetection } from '@/server/engine/simulation';
import { consumeToken } from '@/server/rateLimit';

// Added 2026-08-21: a member with a real booking can still spam this route,
// each call spending a real status-corroboration check. Generous burst —
// this is a real "my flight died" action, not something to make a member
// hesitate over — but bounded.
const REPORT_RATE_LIMIT = { capacity: 10, refillPerMinute: 2 };

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await requireSession(req);
  if ('response' in g) return g.response;

  const limited = consumeToken(`report-cancellation:${g.passenger.id}`, REPORT_RATE_LIMIT);
  if (!limited.allowed) {
    return NextResponse.json(
      { error: 'Too many reports — please slow down.', retryAfterMs: limited.retryAfterMs },
      { status: 429 },
    );
  }

  const { id } = await params;
  const flight = await store.getFlight(id);
  if (!flight) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const bookings = await store.getBookingsForFlight(id);
  const own = bookings.find((b) => b.passengerId === g.passenger.id);
  if (!own) {
    return NextResponse.json(
      { error: 'you do not have a booking on this flight' },
      { status: 403 },
    );
  }

  // Repeat presses are idempotent by construction (memberReports keys by
  // passenger), but answering early keeps a jittery tap from re-running the
  // corroboration ladder and spending a status call each time.
  const repeat = hasReported(id, g.passenger.id);

  const verdict = await report(id, g.passenger.id, 'member');

  // We only rebook once our own data actually confirms the cancellation. A
  // report on a flight we can see is fine must NOT silently start moving the
  // member onto another flight — we tell them it is not cancelled and give them
  // a human to call. (Set a flight's ground truth from /ops: "Mark cancelled
  // (data only)".)
  if (!repeat && verdict.confirmed) {
    await detectDisruption(id);
    await widenDetection(id);
  }

  const HELPLINE = '1800 419 2122';

  return NextResponse.json({
    acknowledged: true,
    confirmed: verdict.confirmed,
    status: verdict.confirmed ? 'cancelled' : 'not-cancelled',
    reports: verdict.reports,
    needed: INDEPENDENT_REPORTS_NEEDED,
    evidence: verdict.evidence,
    helpline: verdict.confirmed ? null : HELPLINE,
    message: verdict.confirmed
      ? 'Sorry for the inconvenience. We have checked and this flight is cancelled — we have marked it and started rebooking you now. Nothing is charged without telling you first.'
      : `We have checked with the airline and this flight is not showing as cancelled. Please double-check your gate or booking, and if the airline has told you otherwise, call our helpline on ${HELPLINE} and we will confirm it for you.`,
  });
}
