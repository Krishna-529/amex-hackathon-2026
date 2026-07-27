/**
 * Read-only HTTP facade over the decision ledger.
 *
 * The dashboard renders `rule_path` and the satisfying input straight from
 * `decision_ledger` via this API. If the ledger is empty the dashboard shows
 * nothing — by design. There is no fallback copy baked into the UI.
 */

import { createServer } from 'node:http';
import * as ledger from '../src/ledger';
import { timelineRows } from '../src/report';
import {
  API_PORT,
  CARD_MEMBER,
  DISRUPTION,
  ORIGINAL_ITINERARY,
  REGULATOR,
  CURRENCY,
  hhmm,
  inr,
} from '../src/scenario';
import type { RecoveryResult } from '../worker/types';

function latestRecovered(): RecoveryResult | null {
  const row = ledger.latestRun('success') ?? ledger.latestRun();
  if (!row?.result) return null;
  return JSON.parse(row.result) as RecoveryResult;
}

function state() {
  const result = latestRecovered();
  if (!result) return { ok: false, error: 'No completed run in the ledger — run `npm run demo` first.' };

  const decisions = ledger.decisionsForRun(result.runId);
  const byId = new Map(decisions.map((d) => [d.id, d]));

  const rows = timelineRows(result).map((r) => {
    const d = byId.get(r.decisionId);
    return {
      ...r,
      // Everything under `policy` comes out of decision_ledger, not the code.
      policy: d
        ? {
            decisionId: d.id,
            rulePath: d.rule_path,
            package: d.package,
            subject: d.subject,
            allowed: Boolean(d.allowed),
            input: JSON.parse(d.input),
            result: JSON.parse(d.result),
            reasons: JSON.parse(d.reasons),
            evalMs: d.eval_ms,
            timestamp: d.timestamp,
          }
        : null,
    };
  });

  return {
    ok: true,
    generatedFrom: 'decision_ledger',
    run: {
      runId: result.runId,
      workflowId: result.workflowId,
      status: result.status,
      mode: result.mode,
      totalChargedInr: result.totalChargedInr,
      totalChargedLabel: inr(result.totalChargedInr),
    },
    cardMember: CARD_MEMBER,
    regulator: REGULATOR,
    currency: CURRENCY,
    disruption: {
      ...DISRUPTION,
      detectedAtLabel: hhmm(DISRUPTION.detectedAtIso),
      scheduledDepartLabel: hhmm(DISRUPTION.scheduledDepartIso),
      originalArrivalLabel: hhmm(ORIGINAL_ITINERARY.legs[0].arriveIso),
    },
    timeline: rows,
    dutyOfCare: result.dutyOfCare,
    chosen: result.chosen,
    offersConsidered: result.offersConsidered,
    decisions: decisions.map((d) => ({
      id: d.id,
      seq: d.seq,
      subject: d.subject,
      package: d.package,
      rulePath: d.rule_path,
      allowed: Boolean(d.allowed),
      reasons: JSON.parse(d.reasons),
      timestamp: d.timestamp,
    })),
    counts: {
      decisions: decisions.length,
      allow: decisions.filter((d) => d.allowed).length,
      deny: decisions.filter((d) => !d.allowed).length,
    },
  };
}

/** The disruption push, assembled from the same scenario the saga ran on. */
function push() {
  const s = state() as any;
  return {
    ok: s.ok,
    appName: 'Amex Travel',
    time: hhmm(DISRUPTION.detectedAtIso),
    title: `${DISRUPTION.flight} Chennai→Delhi cancelled`,
    body: `${CARD_MEMBER.firstName}, your ${hhmm(DISRUPTION.scheduledDepartIso)} Chennai→Delhi flight is cancelled. I've found a re-route that still makes your London board meeting.`,
    cancelledLeg: {
      flight: DISRUPTION.flight,
      sector: 'Chennai → Delhi',
      scheduled: hhmm(DISRUPTION.scheduledDepartIso),
      status: 'CANCELLED',
    },
    proposal: s.ok ? s.timeline[0] : null,
    affirmativeControl: 'Rebook me',
    secondaryControl: 'See options',
    dutyOfCare: s.ok ? s.dutyOfCare : null,
  };
}

const server = createServer((req, res) => {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('content-type', 'application/json');
  try {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname === '/api/state') return res.end(JSON.stringify(state()));
    if (url.pathname === '/api/push') return res.end(JSON.stringify(push()));
    if (url.pathname === '/api/health') return res.end(JSON.stringify({ ok: true }));
    if (url.pathname.startsWith('/api/decisions/')) {
      const id = Number(url.pathname.split('/').pop());
      const d = ledger.decisionById(id);
      if (!d) {
        res.statusCode = 404;
        return res.end(JSON.stringify({ ok: false, error: 'no such decision' }));
      }
      return res.end(
        JSON.stringify({ ...d, input: JSON.parse(d.input), result: JSON.parse(d.result), reasons: JSON.parse(d.reasons) }),
      );
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ ok: false, error: 'not found' }));
  } catch (err) {
    res.statusCode = 500;
    res.end(JSON.stringify({ ok: false, error: String(err) }));
  }
});

server.listen(API_PORT, '127.0.0.1', () => {
  console.log(`ledger API listening on http://127.0.0.1:${API_PORT}`);
});
