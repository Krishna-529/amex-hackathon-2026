/**
 * The FAILED_FALLBACK note the member reads.
 *
 * Split out of saga.ts deliberately, on top of the correctness reason below:
 * saga.ts pulls in the full supplier and hotel registries — real HTTP clients,
 * OAuth flows, the governor — and this is a pure string decision with none of
 * that. Keeping it here means server/pipeline/verify.ts can exercise it
 * directly under `node --experimental-strip-types` without dragging that whole
 * graph into a test process.
 *
 * This is the one string a member reads to decide whether it is safe to go
 * book their own replacement — get it wrong and the failure mode is a double
 * charge: an un-rollbackable flight commit stays live with the airline while
 * the member, told "nothing has been charged", books a second ticket
 * themselves.
 *
 * So the blanket "everything was released" line is only used when every
 * compensation actually succeeded. If any failed, the note names what could
 * not be confirmed released and tells the member explicitly not to act on
 * their own — the orphan itself (with its ref) is on the run and on /ops for a
 * human to chase, but the member-facing text must never assert a release that
 * did not happen.
 */
export function fallbackNote(error: string, rolledBack: { component: string; ok: boolean }[]): string {
  const stuck = rolledBack.filter((r) => !r.ok).map((r) => r.component);
  if (stuck.length === 0) {
    return `We could not complete this: ${error}. Anything already reserved has been released, and nothing has been charged to you.`;
  }
  return `We could not complete this: ${error}. We were not able to confirm that everything already reserved was released (${stuck.join(', ')}) — that is with a human now. Nothing has been charged to your card, but please do not book a replacement yourself until you hear from us, in case what we could not release is still active.`;
}
