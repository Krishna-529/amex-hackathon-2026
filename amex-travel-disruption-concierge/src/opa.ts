/**
 * Open Policy Agent client.
 *
 * The policy gate is real Rego, evaluated at runtime by `opa run --server`.
 * There is deliberately no allow/deny logic in TypeScript anywhere in this
 * repo — this module only carries inputs to OPA and results back, and writes
 * every decision to the ledger.
 */

import { OPA_URL } from './scenario';
import { recordDecision } from './ledger';
import { latency, sleep } from '../mocks/suppliers';
import * as vclock from './clock';

export interface PolicyDecision {
  decisionId: number;
  rulePath: string;
  package: string;
  allowed: boolean;
  reasons: string[];
  result: any;
  input: any;
  subject: string;
}

async function evaluate(packagePath: string, input: unknown): Promise<any> {
  const res = await fetch(`${OPA_URL}/v1/data/${packagePath.replace(/\./g, '/')}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ input }),
  });
  if (!res.ok) throw new Error(`OPA ${res.status}: ${await res.text()}`);
  const body = (await res.json()) as { result?: any };
  if (body.result === undefined) {
    throw new Error(`OPA returned no result for ${packagePath} — is the policy bundle loaded?`);
  }
  return body.result;
}

/** Gate a proposed re-booking against concierge.rebook. */
export async function evaluateRebook(args: {
  runId: string;
  workflowId: string;
  subject: string;
  action: Record<string, unknown>;
}): Promise<PolicyDecision> {
  await sleep(latency().opa);
  vclock.advance(50);
  const input = { action: args.action };
  const result = await evaluate('concierge.rebook', input);
  const allowed = result.allow === true;
  const reasons: string[] = allowed ? [] : (result.deny ?? []);
  const rulePath = allowed ? 'concierge.rebook.allow' : 'concierge.rebook.deny';
  const decisionId = recordDecision({
    runId: args.runId,
    workflowId: args.workflowId,
    subject: args.subject,
    package: 'concierge.rebook',
    rulePath,
    input,
    result,
    allowed,
    reasons,
    evalMs: 50,
  });
  return { decisionId, rulePath, package: 'concierge.rebook', allowed, reasons, result, input, subject: args.subject };
}

/** Evaluate DGCA duty of care against concierge.dutyofcare. */
export async function evaluateDutyOfCare(args: {
  runId: string;
  workflowId: string;
  subject: string;
  input: Record<string, unknown>;
  /** Which owed entitlement this evaluation is authorising, if any. */
  requires?: string;
}): Promise<PolicyDecision> {
  await sleep(latency().opa);
  vclock.advance(50);
  const result = await evaluate('concierge.dutyofcare', args.input);
  const owed: string[] = result.owed ?? [];
  const allowed = args.requires ? owed.includes(args.requires) : owed.length > 0;
  const rulePath = args.requires ? `concierge.dutyofcare.owed["${args.requires}"]` : 'concierge.dutyofcare.packet';
  const decisionId = recordDecision({
    runId: args.runId,
    workflowId: args.workflowId,
    subject: args.subject,
    package: 'concierge.dutyofcare',
    rulePath,
    input: args.input,
    result,
    allowed,
    reasons: allowed ? [] : [`entitlement_not_owed:${args.requires ?? 'none'}`],
    evalMs: 50,
  });
  return {
    decisionId,
    rulePath,
    package: 'concierge.dutyofcare',
    allowed,
    reasons: allowed ? [] : [`entitlement_not_owed:${args.requires ?? 'none'}`],
    result,
    input: args.input,
    subject: args.subject,
  };
}

export async function waitForOpa(timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${OPA_URL}/health`);
      if (res.ok) {
        // Confirm the bundle actually loaded, not just that the server is up.
        const probe = await fetch(`${OPA_URL}/v1/data/concierge/rebook`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ input: { action: {} } }),
        });
        if (probe.ok) {
          const body = (await probe.json()) as any;
          if (body.result && body.result.allow === false) return;
        }
      }
    } catch {
      /* not up yet */
    }
    await sleep(200);
  }
  throw new Error(`OPA did not become ready at ${OPA_URL} within ${timeoutMs}ms`);
}
