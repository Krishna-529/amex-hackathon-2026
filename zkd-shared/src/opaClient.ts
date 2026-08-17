import type { PolicyDecision, PolicyDenyReason, PolicyInput } from './types';

/**
 * The one enforcement point for "every side effect requires exactly one
 * allow" (03-action-policy.md §5, architecture diagram Part 03). Called from
 * inside zkd-execute's activities, immediately before each mutating supplier
 * call — never trusted as something PLAN already checked, because PLAN's own
 * call to this same function is a cheap early filter, not the authorization.
 *
 * Fail-closed: an unreachable OPA is a deny, not a pass-through. "Default
 * deny" has to hold even when the thing evaluating it is unreachable, or it
 * isn't really default-deny.
 */
export async function evaluatePolicy(input: PolicyInput, opaUrl?: string): Promise<PolicyDecision> {
  const base = opaUrl ?? process.env.OPA_URL ?? 'http://localhost:8181';
  try {
    const res = await fetch(`${base}/v1/data/zkd/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input }),
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) return failClosed(`OPA responded ${res.status}`);

    const json = (await res.json()) as { result?: { allow?: boolean; deny?: string[] } };
    if (json.result?.allow === undefined) return failClosed('OPA response missing result.allow');

    return {
      allow: json.result.allow,
      deny: (json.result.deny ?? []) as PolicyDenyReason[],
      evaluatedAt: Date.now(),
      failClosed: false,
    };
  } catch (e) {
    return failClosed(e instanceof Error ? e.message : 'OPA unreachable');
  }
}

function failClosed(note: string): PolicyDecision {
  return { allow: false, deny: [], evaluatedAt: Date.now(), failClosed: true, note };
}
