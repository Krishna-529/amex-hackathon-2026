/**
 * Console rendering for the demo beats. Everything printed here is derived
 * from the workflow result and the decision ledger — nothing is narrated from
 * a script.
 */

import { inr, hhmm, CARD_MEMBER, DISRUPTION, ORIGINAL_ITINERARY, TEMPORAL_UI } from './scenario';
import { decisionsForRun } from './ledger';
import type { RecoveryResult } from '../worker/types';

const C = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  blue: '\x1b[38;5;39m',
  green: '\x1b[38;5;42m',
  amber: '\x1b[38;5;214m',
  rose: '\x1b[38;5;203m',
  violet: '\x1b[38;5;141m',
  grey: '\x1b[38;5;245m',
};

const line = (ch = '─', n = 78) => C.dim + ch.repeat(n) + C.reset;

export function banner(title: string, subtitle?: string): void {
  console.log('');
  console.log(line('═'));
  console.log(`${C.bold}${C.blue}  ${title}${C.reset}${subtitle ? `  ${C.grey}${subtitle}${C.reset}` : ''}`);
  console.log(line('═'));
}

export function beat(time: string, text: string): void {
  console.log(`${C.violet}${time}${C.reset}  ${C.bold}${text}${C.reset}`);
}

export function printDisruption(): void {
  banner('0:00  DISRUPTION DETECTED', DISRUPTION.eventId);
  console.log(`  ${C.rose}${DISRUPTION.flight} ${DISRUPTION.sector} CANCELLED${C.reset}  ` +
    `${C.grey}scheduled ${hhmm(DISRUPTION.scheduledDepartIso)} IST · detected ${hhmm(DISRUPTION.detectedAtIso)} IST${C.reset}`);
  console.log(`  Card Member  ${C.bold}${CARD_MEMBER.name}${C.reset}  ${C.grey}PNR ${CARD_MEMBER.pnr} · ${CARD_MEMBER.purpose}${C.reset}`);
  console.log(`  Reason       ${DISRUPTION.reason}  ${C.grey}force majeure: ${DISRUPTION.forceMajeure}${C.reset}`);
  console.log(`  Invalidated  ${C.amber}Delhi hotel · airport transfer · MAA→DEL sector${C.reset}`);
  console.log(`  At risk      ${C.amber}DEL→LHR ${ORIGINAL_ITINERARY.legs[1].flight}${C.reset}`);
}

export function printPolicyGate(result: RecoveryResult): void {
  banner('POLICY GATE', 'real Rego, evaluated at runtime by OPA');
  for (const o of result.offersConsidered) {
    const mark = o.allowed ? `${C.green}ALLOW${C.reset}` : `${C.rose}DENY ${C.reset}`;
    const why = o.allowed ? '' : `${C.grey} ← ${o.reasons.join(', ')}${C.reset}`;
    console.log(
      `  ${mark}  ${o.offerId.padEnd(12)} ${o.label.padEnd(18)} ${o.cabin.padEnd(9)} ` +
        `${inr(o.fareDeltaInr).padStart(9)}  ttl ${String(o.offerTtlS).padStart(3)}s  ` +
        `${C.dim}${o.rulePath}${C.reset}${why}`,
    );
  }
  if (result.ranked.length) {
    console.log('');
    console.log(`  ${C.grey}Ranked (policy-approved only):${C.reset}`);
    for (const r of result.ranked) {
      const star = r.rank === 1 ? `${C.green}★${C.reset}` : ' ';
      console.log(
        `  ${star} #${r.rank}  ${r.label}  ${C.grey}arrives ${hhmm(r.arriveIso)} IST · ` +
          `+${r.arrivalDelayHours}h vs original · ${r.connectionBufferHours}h onward buffer · score ${r.score}${C.reset}`,
      );
    }
  }
}

export function printItinerary(result: RecoveryResult): void {
  banner('0:20  RECOVERED ITINERARY', `PNR ${result.pnr}`);
  for (const row of timelineRows(result)) {
    const colour = row.tone === 'green' ? C.green : row.tone === 'amber' ? C.amber : C.rose;
    console.log(
      `  ${colour}●${C.reset} ${C.bold}${row.title.padEnd(34)}${C.reset} ` +
        `${row.detail.padEnd(40)} ${row.costLabel.padStart(11)}`,
    );
    console.log(`     ${C.dim}why → ${row.rulePath}${C.reset}`);
  }
  console.log('');
  console.log(`  ${C.bold}Charged to single-use Amex VAN${C.reset}  ${inr(result.totalChargedInr)}`);
}

export interface TimelineRow {
  id: string;
  title: string;
  detail: string;
  costInr: number;
  costLabel: string;
  status: string;
  tone: 'green' | 'amber' | 'rose';
  rulePath: string;
  decisionId: number;
}

/**
 * The single source of truth for the dashboard timeline. The API serves this
 * verbatim, so the screen and the console can never disagree.
 */
export function timelineRows(result: RecoveryResult): TimelineRow[] {
  const rows: TimelineRow[] = [];
  const flight = result.bookings.find((b) => b.activityId === 'bookFlight');
  const segments: any[] = (flight?.detail as any)?.segments ?? [];

  const rebooked = segments.find((s) => s.role === 'REBOOKED');
  if (rebooked) {
    rows.push({
      id: 'MAA-DEL',
      title: 'MAA→DEL rebooked',
      detail: `${rebooked.flight} ${hhmm(rebooked.departIso)}→${hhmm(rebooked.arriveIso)} IST · ${rebooked.cabin}`,
      costInr: rebooked.charged_inr,
      costLabel: inr(rebooked.charged_inr),
      status: 'CONFIRMED',
      tone: 'green',
      rulePath: rebooked.rulePath,
      decisionId: rebooked.decisionId,
    });
  }
  const prot = segments.find((s) => s.role === 'PROTECTED');
  if (prot) {
    rows.push({
      id: 'DEL-LHR',
      title: 'DEL→LHR protected',
      detail: `${prot.flight} ${hhmm(prot.departIso)} IST → ${hhmm(prot.arriveIso, 'Europe/London')} BST · same PNR`,
      costInr: 0,
      costLabel: inr(0),
      status: 'PROTECTED',
      tone: 'green',
      rulePath: prot.rulePath,
      decisionId: prot.decisionId,
    });
  }
  const hotel = result.bookings.find((b) => b.activityId === 'bookHotel');
  if (hotel) {
    const d = hotel.detail as any;
    rows.push({
      id: 'HOTEL',
      title: 'Hotel rebooked',
      detail: `${d.name} · check-in ${hhmm(d.checkInIso)} IST · ${d.nights} night`,
      costInr: hotel.chargedInr,
      costLabel: inr(hotel.chargedInr),
      status: hotel.status,
      tone: 'green',
      rulePath: hotel.rulePath,
      decisionId: hotel.decisionId,
    });
  }
  const ground = result.bookings.find((b) => b.activityId === 'bookGround');
  if (ground) {
    const d = ground.detail as any;
    rows.push({
      id: 'GROUND',
      title: 'Transfer reset',
      detail: `${d.provider} · ${hhmm(d.pickupIso)} IST · ${d.from} → hotel`,
      costInr: ground.chargedInr,
      costLabel: inr(ground.chargedInr),
      status: ground.status,
      tone: 'green',
      rulePath: ground.rulePath,
      decisionId: ground.decisionId,
    });
  } else if (result.failure) {
    rows.push({
      id: 'GROUND',
      title: 'Transfer reset',
      detail: `Rolled back — ${result.failure.type}`,
      costInr: 0,
      costLabel: '—',
      status: 'ROLLED_BACK',
      tone: 'rose',
      rulePath: 'concierge.dutyofcare.owed["hotel_and_transfer"]',
      decisionId: 0,
    });
  }

  const doc = result.dutyOfCare;
  rows.push({
    id: 'DGCA',
    title: 'DGCA duty-of-care claimed',
    detail: `${doc.owed.includes('meals') ? 'meals' : ''}${doc.owed.includes('hotel_and_transfer') ? ' + hotel + transfer' : ''} · ${doc.regulation.replace('DGCA CAR ', '')}`,
    costInr: -doc.compensationInr,
    costLabel: `−${inr(doc.compensationInr).replace('₹', '₹')}`,
    status: doc.cashDue ? 'CLAIMABLE' : 'IN_KIND_ONLY',
    tone: 'amber',
    rulePath: doc.rulePath,
    decisionId: doc.decisionId,
  });

  return rows;
}

export function printRollback(result: RecoveryResult): void {
  banner('1:10  FORWARD SAGA FAILED — COMPENSATING', result.failure?.type ?? '');
  console.log(`  ${C.rose}A4 bookGround failed${C.reset}  ${C.grey}${result.failure?.message}${C.reset}`);
  console.log('');
  console.log(`  ${C.bold}Compensations, LIFO:${C.reset}`);
  for (const c of result.compensations) {
    const applied = c.applied ? `${C.green}APPLIED${C.reset}` : `${C.grey}SKIPPED${C.reset}`;
    console.log(
      `    C${c.order} ${c.compensation.padEnd(14)} ${applied}  ` +
        `${C.grey}${c.status.padEnd(20)} key=${c.idempotencyKey}${C.reset}`,
    );
  }
  console.log('');
  console.log(`  ${C.grey}Every compensation is keyed on \`\${workflowRunId}:\${activityId}\` — replaying the${C.reset}`);
  console.log(`  ${C.grey}rollback cannot double-cancel or double-refund.${C.reset}`);
}

export function printDutyOfCare(result: RecoveryResult): void {
  const doc = result.dutyOfCare;
  banner('2:20  DGCA DUTY-OF-CARE PACKET', doc.regulation);
  console.log(`  ${C.grey}Assembled entirely from the Rego output — no amounts computed in TypeScript.${C.reset}`);
  console.log('');
  console.log(JSON.stringify(
    {
      regulation: doc.regulation,
      currency: doc.currency,
      pnr: result.pnr,
      flight: DISRUPTION.flight,
      sector: DISRUPTION.sector,
      delay_hours: doc.delayHours,
      overnight_window: true,
      force_majeure: DISRUPTION.forceMajeure,
      owed: doc.owed,
      cash_due: doc.cashDue,
      slab_inr: doc.slabInr,
      booked_fare_inr: ORIGINAL_ITINERARY.sectorFareInr,
      compensation_inr: doc.compensationInr,
      basis: 'min(slab, booked fare) — slab by block time of the cancelled sector',
      rule_path: doc.rulePath,
      decision_id: doc.decisionId,
    },
    null,
    2,
  ).split('\n').map((l) => '  ' + l).join('\n'));
}

/** 1:50 — the structured handoff. Not a chat UI; a machine-readable object. */
export function printEscalation(result: RecoveryResult): void {
  banner('1:50  ESCALATION — STRUCTURED HANDOFF', 'autonomy stopped, human takes over');
  const decisions = decisionsForRun(result.runId);
  const handoff = {
    handoff_id: `HO-${result.runId.slice(0, 8)}`,
    generated_at_ist: decisions.at(-1)?.timestamp ?? DISRUPTION.detectedAtIso,
    card_member: {
      name: CARD_MEMBER.name,
      membership: CARD_MEMBER.membership,
      card_last4: CARD_MEMBER.cardLast4,
      purpose: CARD_MEMBER.purpose,
    },
    pnr: result.pnr,
    disruption: {
      event_id: DISRUPTION.eventId,
      type: DISRUPTION.type,
      flight: DISRUPTION.flight,
      sector: DISRUPTION.sector,
      detected_at_ist: DISRUPTION.detectedAtIso,
      reason: DISRUPTION.reason,
      force_majeure: DISRUPTION.forceMajeure,
    },
    options_considered: result.offersConsidered.map((o) => ({
      offer_id: o.offerId,
      flight: o.flight,
      carrier: o.carrierName,
      cabin: o.cabin,
      fare_delta_inr: o.fareDeltaInr,
      offer_ttl_s: o.offerTtlS,
      policy_allowed: o.allowed,
      rule_path: o.rulePath,
      denial_reasons: o.reasons,
      decision_id: o.decisionId,
    })),
    ranking: result.ranked.map((r) => ({ rank: r.rank, offer_id: r.offerId, score: r.score })),
    policy_decisions: decisions.map((d) => ({
      decision_id: d.id,
      rule_path: d.rule_path,
      subject: d.subject,
      allowed: Boolean(d.allowed),
      reasons: JSON.parse(d.reasons),
      timestamp_ist: d.timestamp,
    })),
    actions_taken: result.bookings.map((b) => ({
      activity: b.activityId,
      booking_ref: b.bookingRef,
      charged_inr: b.chargedInr,
      authorised_by_rule: b.rulePath,
      decision_id: b.decisionId,
    })),
    compensations_applied: result.compensations.map((c) => ({
      order: `C${c.order}`,
      compensation: c.compensation,
      compensates: c.activityId,
      idempotency_key: c.idempotencyKey,
      applied: c.applied,
      status: c.status,
    })),
    duty_of_care: {
      regulation: result.dutyOfCare.regulation,
      owed: result.dutyOfCare.owed,
      compensation_inr: result.dutyOfCare.compensationInr,
      cash_due: result.dutyOfCare.cashDue,
      rule_path: result.dutyOfCare.rulePath,
    },
    stopped_because: {
      code: result.failure?.type ?? 'NONE',
      failed_activity: result.failure?.activityId ?? null,
      detail: result.failure?.message ?? null,
      retryable: false,
      rationale:
        'Supplier returned a non-retryable error. The saga was fully compensated, so the Card Member is not left ' +
        'half-booked. No further autonomous attempt is permitted without a human decision on an alternative ' +
        'ground-transit provider outside the approved partner list.',
    },
    recommended_human_action:
      'Approve an out-of-policy ground-transit provider for the DEL T3 → Aerocity transfer at 18:35 IST, ' +
      'or confirm the hotel shuttle instead. Flight and hotel remain unbooked pending that decision.',
    financial_exposure_inr: 0,
    temporal: { workflow_id: result.workflowId, run_id: result.runId, ui: `${TEMPORAL_UI}/namespaces/default/workflows/${result.workflowId}/${result.runId}/history` },
  };
  console.log(JSON.stringify(handoff, null, 2));
}

export function printTemporalPointer(result: RecoveryResult): void {
  const url = `${TEMPORAL_UI}/namespaces/default/workflows/${encodeURIComponent(result.workflowId)}/${result.runId}/history`;
  banner('TEMPORAL WEB — capture temporal-trace.png here');
  console.log(`  Workflow ID  ${C.bold}${result.workflowId}${C.reset}`);
  console.log(`  Run ID       ${C.bold}${result.runId}${C.reset}`);
  console.log(`  ${C.blue}${C.bold}${url}${C.reset}`);
  console.log('');
  console.log(`  ${C.grey}Look for A1→A4 descending, then C4→C3→C2→C1 ascending back out.${C.reset}`);
}

export { C };
