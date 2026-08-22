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

  if (!repeat) {
    if (verdict.confirmed) {
      // Corroborated: this is a real cancellation as far as we can tell, and
      // everyone on the aircraft is in the same trouble.
      await detectDisruption(id);
      await widenDetection(id);
    } else {
      // Uncorroborated: believe them about THEIR trip and nobody else's. The
      // pipeline this starts searches and plans; it does not spend until the
      // consent window it opens has run, and it never touches another
      // passenger's card.
      await detectDisruption(id, { onlyForPassengerId: g.passenger.id });
    }
  }

  return NextResponse.json({
    acknowledged: true,
    confirmed: verdict.confirmed,
    reports: verdict.reports,
    needed: INDEPENDENT_REPORTS_NEEDED,
    evidence: verdict.evidence,
    message: verdict.confirmed
      ? 'Thank you — that matches what we can see. We have started the rebooking for everyone on this flight.'
      : 'Thank you. We have started your rebooking now. We have not yet been able to confirm the cancellation independently, so we are not moving other passengers until we can.',
  });
}
