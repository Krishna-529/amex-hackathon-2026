/**
 * A member's free-text preference prompt ("arrive before 6pm," "avoid
 * layovers") re-ranks the SAME candidate portfolio server/engine/simulation.ts
 * already picked from — never a flight the member wasn't already shown a
 * chance to book. Bedrock (server/bedrock.ts) only ever parses the prompt
 * into a structured, narrow patch (server/preferences/refinePatch.ts); the
 * actual ranking is always the real deterministic scorer
 * (server/pipeline/score.ts), so a member can never be routed to a flight
 * that doesn't survive the same hard rules and MyCa gates every other
 * candidate does.
 *
 * Default path re-ranks flight.candidates.alts — already fetched during
 * WARM, no new supplier call, matching the agent-spec's explicit mandate
 * ("a fresh live fan-out per intervention... is exactly the churn the
 * coordinator exists to prevent"). Only if the patch makes the EXISTING
 * pool structurally empty (not just stale) does a fresh, separately and
 * more tightly rate-limited supplier search run.
 */
import * as store from '../domain/store';
import { fetchProfile } from '../myca';
import { adapt, defaultWireFor } from '../preferences/adapt';
import type { RebookingRules } from '../preferences/adapt';
import { parsePreferencePrompt } from '../bedrock';
import { altsForParty } from '../domain/altsForParty';
import { applyHardRules, rankAlts, type ScoreContext } from '../pipeline/score';
import { localTime } from '../airportDirectory';
import { refreshAlts } from './altsCache';
import { consumeToken } from '../rateLimit';
import type { Flight, OptionReason } from '../domain/types';

const MAX_PROMPT_LEN = 240;

/** Same length-cap + control-char-strip discipline as app/api/explain/route.ts's
 *  clean() — the one other place free text reaches an LLM prompt in this repo. */
function cleanPrompt(v: string): string {
  // eslint-disable-next-line no-control-regex
  return v.replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, MAX_PROMPT_LEN);
}

const CABIN_RANK: Record<string, number> = { Economy: 0, 'Premium Economy': 1, Business: 2, First: 3 };

function applyArrivalFilter(
  alts: ReturnType<typeof altsForParty>,
  destination: string,
  arrivalBeforeLocal: string | null,
) {
  if (!arrivalBeforeLocal) return alts;
  return alts.filter((a) => typeof a.arrivesAt !== 'number' || localTime(destination, a.arrivesAt) <= arrivalBeforeLocal);
}

export async function refineWithPreference(flightId: string, passengerId: string, rawPrompt: string): Promise<void> {
  const prompt = cleanPrompt(rawPrompt);
  const task = await store.getRecoveryTask(flightId, passengerId);
  const flight = await store.getFlight(flightId);
  const passenger = await store.getPassenger(passengerId);
  if (!task || !flight || !passenger || task.resolution) return;

  task.refining = true;
  await store.setRecoveryTask(task);

  try {
    const profile = await fetchProfile(passenger.id);
    const wire = passenger.preferencesWire ?? defaultWireFor(passenger, profile);
    const adapted = adapt(wire, profile.payment.billingCurrency);
    const patch = await parsePreferencePrompt(prompt); // null on any Bedrock failure — see bedrock.ts

    const mergedRules: RebookingRules = patch
      ? {
          ...adapted.rules,
          strategy: patch.optimization_strategy ?? adapted.rules.strategy,
          avoidAirlines: [...new Set([...adapted.rules.avoidAirlines, ...(patch.avoid_airlines_add ?? []).map((c) => c.toUpperCase())])],
          maxLayovers: patch.max_layovers !== undefined ? Math.min(adapted.rules.maxLayovers, patch.max_layovers) : adapted.rules.maxLayovers,
          arrivalBeforeLocal: patch.arrival_before_local ?? adapted.rules.arrivalBeforeLocal,
        }
      : adapted.rules;

    const entitlement = CABIN_RANK[profile.preferences.cabinEntitlement] ?? 0;
    const preferredCabin = (CABIN_RANK[adapted.preferredCabin] ?? 0) <= entitlement
      ? adapted.preferredCabin
      : profile.preferences.cabinEntitlement;

    const buildCtx = (f: Flight): ScoreContext => ({
      flight: f,
      rules: mergedRules,
      preferredCabin,
      partySize: task.partySize,
      cap: profile.preferences.perTransactionCap,
      preferredCarriers: adapted.preferences.preferredCarriers,
      hasHardConstraint: f.hasHardConstraint,
    });

    let partyAlts = applyArrivalFilter(
      altsForParty(flight.candidates.alts, task.partySize).filter((a) => !task.rejectedAltIds.includes(a.id)),
      flight.to,
      mergedRules.arrivalBeforeLocal,
    );
    let outcome = applyHardRules(partyAlts, buildCtx(flight));
    let ranked = rankAlts(outcome.kept, buildCtx(flight));

    // Secondary path: only when the patch itself emptied an otherwise
    // non-empty pool — a stale/genuinely-empty cache is not reason enough
    // to spend a real supplier call on every refine attempt.
    if (patch && outcome.kept.length === 0 && partyAlts.length > 0) {
      const searchLimited = consumeToken(`refine-search:${passengerId}`, { capacity: 2, refillPerMinute: 0.5 });
      if (searchLimited.allowed) {
        await refreshAlts(flightId);
        const refreshed = await store.getFlight(flightId);
        if (refreshed) {
          partyAlts = applyArrivalFilter(
            altsForParty(refreshed.candidates.alts, task.partySize).filter((a) => !task.rejectedAltIds.includes(a.id)),
            refreshed.to,
            mergedRules.arrivalBeforeLocal,
          );
          outcome = applyHardRules(partyAlts, buildCtx(refreshed));
          ranked = rankAlts(outcome.kept, buildCtx(refreshed));
        }
      }
    }

    const top = ranked[0] ?? null;

    // Re-fetch: the task may have moved on (resolved, or the member acted)
    // while the Bedrock call/refresh above was in flight.
    const current = await store.getRecoveryTask(flightId, passengerId);
    if (!current || current.resolution) return;

    current.refining = false;
    current.rankedOptions = ranked.map((r) => ({
      altId: r.alt.id,
      reason: { kind: 'deterministic-score' as const, text: r.why, leadingCriterion: r.score.leadingCriterion },
    }));
    current.excludedAlts = outcome.removed.map((r) => ({ altId: r.id, code: r.code, rule: r.rule }));

    if (!top) {
      current.note = patch
        ? "That preference leaves nothing bookable — showing what we can, with the reason for each exclusion."
        : "Couldn't process your preference right now — nothing changed, still showing our best match.";
    } else {
      current.chosenAltId = top.alt.id;
      const reason: OptionReason = patch
        ? { kind: 'llm-refined', text: `${patch.rationale} ${top.why}`, leadingCriterion: top.score.leadingCriterion, prompt }
        : { kind: 'deterministic-score', text: top.why, leadingCriterion: top.score.leadingCriterion };
      current.chosenAltReason = reason;
      current.note = patch ? 'Updated based on what you asked for.' : "Couldn't process your preference right now — here's our best match, unchanged.";
    }
    await store.setRecoveryTask(current);
  } catch (e) {
    // Never leave the task stuck mid-"thinking" — clear the flag and let the
    // member try again, rather than a permanently-disabled refine box.
    const stuck = await store.getRecoveryTask(flightId, passengerId);
    if (stuck && !stuck.resolution) {
      stuck.refining = false;
      stuck.note = "Couldn't process your preference right now — nothing changed, still showing our best match.";
      await store.setRecoveryTask(stuck);
    }
    console.error('[refine] refineWithPreference failed:', e);
  }
}
