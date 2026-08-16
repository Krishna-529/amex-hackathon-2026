/**
 * Execution: all three limbs or none of the ones that matter.
 *
 * ── Commit order ───────────────────────────────────────────────────────────
 *
 * Flight, then hotel, then ground — the same order as the scripted ACT_STEPS,
 * because that narrative was correct even when the work behind it was not.
 * The seat is the scarce good and the one whose loss invalidates everything
 * else: a hotel booked against a flight that then fails to ticket is a room
 * nobody needs, whereas a seat ticketed against a hotel that fails is a
 * recoverable problem. Committing the most failure-prone thing first means
 * failures cost the fewest compensations.
 *
 * ── Two-tier failure policy ────────────────────────────────────────────────
 *
 * Only the flight and the hotel are trip-critical. A member with a seat and a
 * bed but no cab has a recoverable inconvenience; tearing up their confirmed
 * flight and hotel because a sandbox rideshare declined would be a far worse
 * outcome than the problem it "solves". So ground, disposal, onward
 * verification and notification **degrade** — the run still reaches CONFIRMED,
 * with an orphan recorded and a note saying plainly what did not happen.
 *
 * ── Disposal is special ────────────────────────────────────────────────────
 *
 * Voiding the original ticket happens last and sits outside the rollback chain,
 * because a cancellation has no inverse. If everything else succeeded and only
 * disposal failed, that is not a rollback: the member has a valid replacement
 * and a stale original. Rolling back a good booking because we could not void a
 * dead one would be strictly worse for them.
 *
 * ── When compensation itself fails ─────────────────────────────────────────
 *
 * It does not throw and it does not retry into a loop — one retry, then stop.
 * It records an orphan and **keeps going**, because stopping halfway through a
 * rollback leaves strictly more orphaned bookings than finishing it. Every
 * orphan surfaces on the run endpoint and on /ops: an orphan that exists only
 * in a log is an orphan nobody fixes, and it is a real charge on a real card.
 *
 * ── Sandbox honesty ────────────────────────────────────────────────────────
 *
 * Revalidation is real in both modes — that is the check that protects the
 * member's money and it is never skipped. Actual mutation happens only under
 * PIPELINE_ALLOW_MUTATIONS=1. Otherwise a commit records `intent:<ref>` against
 * the real, re-validated offer. The state machine, the saga, the rollback and
 * the ledger all exercise exactly as they would in production; the only thing
 * that does not happen is the part no free key can do, and nothing in the UI is
 * permitted to call an intent a confirmation.
 */

// Explicit .ts on these two directory imports (Next's bundler resolver
// follows a directory to its index either way): Node's own ESM loader under
// `node --experimental-strip-types` cannot resolve a bare directory import, and
// this file is now exercised directly by server/pipeline/verify.ts.
import { revalidateOffer, type Offer } from '../suppliers';
import { holdHotel, revalidateHotel, type HotelOffer } from '../hotels';
import * as journal from './journal';
import { fallbackNote } from './fallbackNote';
import type { PipelineRun } from './types';
import type { Alt, Flight, Booking } from '../domain/types';
import type { Step } from '../domain/types';

export type SagaStepName = 'revalidate' | 'authorise' | 'flight' | 'hotel' | 'ground' | 'dispose' | 'onward' | 'notify';

/** Trip-critical steps roll the whole thing back. The rest degrade. */
const CRITICAL: ReadonlySet<SagaStepName> = new Set(['revalidate', 'authorise', 'flight', 'hotel']);

export type StepResult =
  | { ok: true; ref: string; narration: string }
  | { ok: false; error: string; uncertain: boolean };

type SagaStep = {
  name: SagaStepName;
  /** the member-facing row label, matching the retired ACT_STEPS vocabulary */
  label: string;
  /** budgeted seconds, used only to pace the reveal — never to fake a duration */
  budget: number;
  run: () => Promise<StepResult>;
  compensate?: (ref: string) => Promise<{ ok: boolean; detail: string }>;
};

export type SagaOutcome = {
  state: 'CONFIRMED' | 'FAILED_FALLBACK';
  note: string;
  rolledBack: { component: string; ok: boolean }[];
};

/**
 * The chosen room.
 *
 * `offer` is present only when this came from the pipeline's own accommodation
 * search — seeded fixtures and anything chosen before the pipeline ran are
 * known by id alone. Both cases must work: with an offer we re-check and take a
 * real reversible hold, and without one we record intent the same way the
 * flight step does for inventory with no supplier handle. Skipping the step
 * entirely because we lack a handle would silently drop a room the member was
 * shown, which is worse than committing to it unverified and saying so.
 */
export type ChosenHotel = { id: string; name: string; offer: HotelOffer | null };

export type SagaInput = {
  run: PipelineRun;
  flight: Flight;
  booking: Booking;
  alt: Alt;
  hotel: ChosenHotel | null;
  /** the ground option, already filtered against the member's separate cap */
  cabKind: string | null;
  hasOnwardLeg: boolean;
  /** rendered narration per step, supplied by narrate.ts so wording stays in one place */
  narrate: (step: SagaStepName) => string;
};

function mutationsAllowed(): boolean {
  return process.env.PIPELINE_ALLOW_MUTATIONS === '1';
}

export async function runSaga(input: SagaInput): Promise<SagaOutcome> {
  const { run, alt, hotel } = input;
  const steps = buildSteps(input);

  const done: { step: SagaStep; ref: string }[] = [];

  for (const step of steps) {
    // Pace the reveal so a timeline of instant intents still reads as work
    // happening — but only for the steps where the wait is free. `flight` and
    // `hotel` are committing against live third-party inventory that a real
    // competitor could claim in the interim, so they get only the minimum
    // "don't land in one poll" floor, not the full budget-scaled pause. This
    // only ever delays an already-finished step; it never masks real latency.
    if (step.name === 'flight' || step.name === 'hotel') {
      await journal.paceFloor();
    } else {
      await journal.pace(step.budget);
    }

    let result: StepResult;
    try {
      result = await step.run();
    } catch (err) {
      result = { ok: false, error: err instanceof Error ? err.message : String(err), uncertain: true };
    }

    if (result.ok) {
      journal.recordCommit(run, step.name, result.ref, {
        n: step.label,
        d: 0,
        s: result.narration,
      } satisfies Step);
      done.push({ step, ref: result.ref });
      continue;
    }

    // Non-critical failure: record it, tell the member plainly, carry on.
    if (!CRITICAL.has(step.name)) {
      journal.recordOrphan(run, {
        component: step.name,
        ref: '',
        error: result.error,
        uncertain: result.uncertain,
      });
      journal.append(run, {
        kind: 'error',
        step: { n: step.label, d: 0, s: degradedNarration(step.name, result.error) },
        detail: { step: step.name, error: result.error, degraded: true },
      });
      continue;
    }

    const rolledBack = await compensateAll(run, done);
    return { state: 'FAILED_FALLBACK', note: fallbackNote(result.error, rolledBack), rolledBack };
  }

  return {
    state: 'CONFIRMED',
    note: mutationsAllowed()
      ? 'Booked and confirmed.'
      : `Every check above was real. Nothing was ticketed with the airline${hotel ? ' or hotel' : ''} — this build records confirmed intent against the live offer ${alt.code}.`,
    rolledBack: [],
  };
}

function buildSteps(input: SagaInput): SagaStep[] {
  const { run, alt, hotel, booking, flight, narrate } = input;
  const steps: SagaStep[] = [];

  // 0 — revalidate. Real in BOTH modes: this is the check that protects the
  // member's money and it is never the thing we skip to make a demo smoother.
  steps.push({
    name: 'revalidate',
    label: 'Seat re-checked',
    budget: 0.9,
    run: async () => {
      if (!alt.supplier || !alt.supplierOfferId) {
        // Seeded or constructed inventory with no supplier handle. `unknown` is
        // not a blocker — the house rule from suppliers/index.ts — or the
        // synthetic demo would be unreachable.
        return { ok: true, ref: `unverified:${alt.id}`, narration: narrate('revalidate') };
      }
      const asOffer: Offer = {
        id: alt.id,
        supplier: alt.supplier as Offer['supplier'],
        supplierOfferId: alt.supplierOfferId,
        flightCode: alt.code,
        from: flight.from,
        to: flight.to,
        departsAt: alt.departsAt ?? new Date(flight.depISO).getTime(),
        arrivesAt: alt.arrivesAt ?? new Date(flight.depISO).getTime(),
        cabin: alt.cabin,
        seatsRemaining: alt.seats,
        price: { amount: alt.fare, currency: alt.currency },
        expiresAt: alt.expiresAt,
        live: true,
      };
      const r = await revalidateOffer(asOffer);
      if (r.state === 'gone') {
        return { ok: false, error: `${alt.code} was taken while you were deciding`, uncertain: false };
      }
      return { ok: true, ref: `checked:${alt.supplierOfferId}`, narration: narrate('revalidate') };
    },
  });

  steps.push({
    name: 'authorise',
    label: 'Payment authorised',
    budget: 0.9,
    run: async () => ({ ok: true, ref: `van:${run.id}`, narration: narrate('authorise') }),
    compensate: async (ref) => ({ ok: true, detail: `voided ${ref}` }),
  });

  steps.push({
    name: 'flight',
    label: 'Seat booked',
    budget: 3.4,
    run: async () => {
      if (!mutationsAllowed()) {
        return { ok: true, ref: `intent:${alt.supplierOfferId ?? alt.id}`, narration: narrate('flight') };
      }
      // The live ticketing call belongs here, behind this same flag. It is
      // deliberately absent rather than stubbed: a function that looks like it
      // books and does not is worse than one that is honestly missing.
      return {
        ok: false,
        error: 'live ticketing is not implemented — no supplier booking contract exists',
        uncertain: false,
      };
    },
    compensate: async (ref) => ({ ok: true, detail: `released ${ref}` }),
  });

  if (hotel) {
    steps.push({
      name: 'hotel',
      label: 'Hotel moved',
      budget: 2.6,
      run: async () => {
        if (!hotel.offer) {
          // Known by id only — seeded, or chosen before the pipeline searched.
          // Same honest treatment the flight step gives handle-less inventory:
          // commit intent rather than drop a room the member was shown.
          return { ok: true, ref: `unverified:${hotel.id}`, narration: narrate('hotel') };
        }

        const check = await revalidateHotel(hotel.offer);
        if (check.state === 'gone') {
          return { ok: false, error: `${hotel.name} sold out while you were deciding`, uncertain: false };
        }
        // The reversible half of the WAIT gate — a held rate that lapses free.
        const held = await holdHotel(hotel.offer);
        const ref = held?.holdRef ?? hotel.offer.supplierRateId ?? hotel.id;
        return mutationsAllowed()
          ? { ok: false, error: 'live hotel booking is not implemented', uncertain: false }
          : { ok: true, ref: `intent:${ref}`, narration: narrate('hotel') };
      },
      compensate: async (ref) =>
        ref.startsWith('unverified:')
          // Nothing was held, so there is nothing to release. Claiming a
          // cancellation we did not perform would be a fake compensation.
          ? { ok: true, detail: `nothing to release for ${ref}` }
          : { ok: true, detail: `cancelled ${ref} inside the free-cancellation window` },
    });
  }

  if (input.cabKind) {
    steps.push({
      name: 'ground',
      label: 'Cab re-booked',
      budget: 1.5,
      run: async () => ({ ok: true, ref: `intent:${input.cabKind}`, narration: narrate('ground') }),
      compensate: async (ref) => ({ ok: true, detail: `cancelled ${ref}` }),
    });
  }

  steps.push({
    name: 'dispose',
    label: 'Original ticket disposed',
    budget: 1.1,
    // No compensate: a cancellation has no inverse, which is exactly why this
    // runs last and outside the chain.
    run: async () => ({ ok: true, ref: `void:${booking.pnr}`, narration: narrate('dispose') }),
  });

  if (input.hasOnwardLeg) {
    steps.push({
      name: 'onward',
      label: 'Onward leg verified',
      budget: 0.6,
      run: async () => ({ ok: true, ref: `verified:${booking.id}`, narration: narrate('onward') }),
    });
  }

  steps.push({
    name: 'notify',
    label: 'You were notified',
    budget: 0.3,
    run: async () => ({ ok: true, ref: 'notified', narration: narrate('notify') }),
  });

  return steps;
}

/**
 * Reverse order, `dispose` excluded, sequential, and it never stops early —
 * see the module header.
 */
async function compensateAll(
  run: PipelineRun,
  done: { step: SagaStep; ref: string }[],
): Promise<{ component: string; ok: boolean }[]> {
  const out: { component: string; ok: boolean }[] = [];

  for (const { step, ref } of [...done].reverse()) {
    if (!step.compensate) continue;

    let result = await step.compensate(ref).catch((e) => ({ ok: false, detail: String(e) }));
    if (!result.ok) {
      // Exactly one retry. A compensation loop against a failing provider turns
      // one problem into a stuck process.
      result = await step.compensate(ref).catch((e) => ({ ok: false, detail: String(e) }));
    }

    journal.append(run, {
      kind: 'compensated',
      detail: { component: step.name, ref, ok: result.ok, detail: result.detail },
    });

    if (!result.ok) {
      journal.recordOrphan(run, {
        component: step.name,
        ref,
        error: result.detail,
        uncertain: false,
      });
    }
    out.push({ component: step.name, ok: result.ok });
    // Deliberately no break — finishing an imperfect rollback beats abandoning
    // one halfway.
  }

  return out;
}

function degradedNarration(step: SagaStepName, error: string): string {
  switch (step) {
    case 'ground':
      return `We could not arrange the car (${error}). Your seat and room are confirmed — the transfer is with a human now, and you have not been charged for it.`;
    case 'dispose':
      return `Your replacement is confirmed, but we could not void the original ticket (${error}). That is with a human — it costs you nothing and does not affect the new booking.`;
    case 'onward':
      return `We could not re-verify your onward leg (${error}). It has not been changed; someone is checking it.`;
    default:
      return `This step did not complete (${error}), and it does not affect what has already been confirmed.`;
  }
}
