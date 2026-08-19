import { redirect } from 'next/navigation';

/**
 * `/prepare/[id]` was folded into `/flights/[id]` on 2026-08-19.
 *
 * Two reasons, and the second is the one that mattered. The pages duplicated
 * each other — both explained the forecast, both listed the alternatives — and
 * a member had to read the risk on one screen and act on it from another. And
 * they did not even look alike: `/flights/[id]` renders on the Amex light skin
 * (see lib/amexRoutes.ts) while this route never did, so following the link
 * went from a white Amex page straight into dark glass.
 *
 * ── Why this is a redirect and not a deletion ──────────────────────────────
 *
 * `server/notify/templates.ts` has been deep-linking `/prepare/<id>` into push
 * and WhatsApp messages. Those are already sitting on members' phones, and a
 * notification that opens a 404 is worse than one that was never sent — it is
 * the exact moment the member most needs the app to work. The templates now
 * point at the flight page, but this route stays until every alert that names
 * it has expired.
 *
 * Safe to delete once no live notification references it.
 */
export default async function PrepareRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/flights/${id}`);
}
