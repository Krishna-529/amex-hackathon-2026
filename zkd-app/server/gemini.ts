/**
 * Gemini REST generateContent. Plain fetch, no SDK — this is a single one-shot
 * text call, not worth a dependency for.
 *
 * Model id note: `gemini-2.5-flash` (the id in round2-api-requirements.csv) is no
 * longer available to new users as of this session — its API error explicitly
 * points at `gemini-flash-latest`, confirmed working here. Using the `-latest`
 * alias so this doesn't rot again the next time Google rotates model ids —
 * though note it can silently resolve to a different pinned version between
 * calls (`gemini-3.6-flash` one day, `gemini-3.7-flash` the next, both
 * observed live), which is exactly why the quota problem below is keyed
 * per-model, not just per-key.
 *
 * ── Retrying a transient overload, not just reporting one ──────────────────
 *
 * A real, reported failure (2026-08-22): a perfectly well-formed member
 * sentence ("I need to land in London by 8pm") came back as "we could not
 * read that" — implying the member's phrasing was the problem. It was not.
 * The actual upstream response was a real Gemini `503 UNAVAILABLE`, "this
 * model is currently experiencing high demand" — visible only by adding
 * temporary logging, because `generate()` swallowed the status and body of
 * every failure with no record anywhere. `extractJson` now reports WHY it
 * gave up, so a caller that wants to (server/preferences/intent.ts does) can
 * tell a member "our assistant is briefly overloaded, try again in a moment"
 * instead of "we could not read that" — different problems, different member
 * actions, and the member is owed knowing which one happened.
 *
 * ── Key rotation, added the same night ──────────────────────────────────────
 *
 * Chasing the 503 above with more live testing hit a second, more serious
 * failure: `429 RESOURCE_EXHAUSTED`, "GenerateRequestsPerDayPerProjectPerModel
 * -FreeTier", limit 20. The free tier allows twenty `generateContent` calls a
 * day, PER KEY, per resolved model version — a ceiling normal iteration
 * during a single test session (let alone a live demo plus rehearsal) blows
 * through easily. No retry or backoff manufactures quota that doesn't exist.
 *
 * What DOES help: this project holds three independently-quota'd keys
 * (`GEMINI_API_KEY`, `_2`, `_3`), and a single exhausted key is a completely
 * different failure from the model itself being down — a fresh key has its
 * own full 20/day allowance regardless of what the first one has burned.
 * `generate()` below round-robins its STARTING key across calls (so ordinary
 * traffic spreads evenly across all three quotas instead of hammering one
 * until it dies, which is exactly what happened tonight), and on any
 * failure — quota-exhausted or a genuine overload — fails over to the next
 * key in rotation within the same request before giving up. Three keys does
 * not mean unlimited: it means ~3x the daily headroom, and the honest
 * 'overloaded' failure reason below still fires, correctly, once every key
 * in the pool is out for the day.
 *
 * ── Stopped chasing "-latest", the same night ───────────────────────────────
 *
 * All three keys failing at once (2026-08-22, later) turned out not to be
 * quota at all: `gemini-flash-latest` was returning a real 503 on every key,
 * while a direct, pinned call to `gemini-3.6-flash` on the SAME key
 * succeeded instantly. `-latest` floats to whatever Google just shipped —
 * the model id note above already caught it resolving to `gemini-3.7-flash`
 * one day and `gemini-3.6-flash` the next — and a just-shipped model is
 * exactly the one every other caller on the free tier is also hammering.
 * Pinning to a specific, already-proven-stable version trades "always the
 * newest" for "not sharing capacity with everyone chasing the newest",
 * which is the right trade for a demo.
 *
 * `MODELS` tries `gemini-flash-lite-latest` FIRST, not the fuller flash
 * model — observed live the same night: three keys on the pinned flash
 * model each hung to its full timeout (36s total) before the lite model
 * answered instantly on the first try. Lite carries zero "thinking" token
 * overhead (confirmed live: 0 vs. flash's 92 for the same prompt) and this
 * is a short structured-extraction task, not creative reasoning — the
 * quality gap that matters for a demo isn't model size, it's whether it
 * answers at all in an interactive request. The fuller model stays as the
 * second tier for a message genuinely complex enough that lite alone can't
 * follow it.
 */

const MODELS = ['gemini-flash-lite-latest', 'gemini-3.6-flash'];
function endpointFor(model: string): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
}

/** Every configured key, in the order they're named — order only matters as
 *  the rotation's starting sequence, not a priority ranking; see rrIndex. */
const KEYS: string[] = [
  process.env.GEMINI_API_KEY,
  process.env.GEMINI_API_KEY_2,
  process.env.GEMINI_API_KEY_3,
].filter((k): k is string => !!k && k.trim().length > 0);

/** Advances on every call (success or failure) so consecutive requests land
 *  on different keys — spreading load pre-emptively, rather than only
 *  reacting to an already-exhausted key. Module-level and unguarded: the
 *  worst a race does is two concurrent calls picking the same start index,
 *  which is no worse than not rotating at all for that one pair of calls. */
let rrIndex = 0;

// Short: keys are tried one attempt each, not retried in place — with three
// independent quotas to fall through, spending a second attempt on the SAME
// key before trying a fresh one is the wrong use of the time budget. This is
// only the pause BETWEEN keys, not a backoff on one.
const INTER_KEY_DELAY_MS = 400;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function explain(prompt: string): Promise<string | null> {
  const result = await generate(prompt, undefined, 15000);
  return result.ok ? result.text.trim() : null;
}

/** Why extractJson came back empty — a caller that cares (readIntent does)
 *  can turn this into a message that tells a member what to actually do,
 *  rather than one generic dead end for three different situations. */
export type ExtractFailureReason =
  | 'unconfigured' // no GEMINI_API_KEY* var set at all — the feature isn't wired up here
  | 'overloaded' // every configured key is quota-exhausted or the model is overloaded
  | 'error'; // anything else: network failure, malformed response, unparseable JSON

export type ExtractResult<T> = { ok: true; value: T } | { ok: false; reason: ExtractFailureReason };

/**
 * The same call, constrained to emit JSON matching `schema`.
 *
 * Structured output is requested from the model (`responseMimeType` +
 * `responseSchema`) AND re-validated by the caller, which is not redundancy for
 * its own sake: the schema tells the model what shape to produce, and it is
 * good at that, but it is not an enforcement boundary. A model can emit a
 * well-formed object with a value nobody authorised — a budget above what the
 * card allows, an airline code that does not exist. Shape is the model's job;
 * legality is ours. See server/preferences/intent.ts, where every field is
 * re-checked and clamped after this returns.
 */
export async function extractJson<T>(
  prompt: string,
  schema: Record<string, unknown>,
): Promise<ExtractResult<T>> {
  const result = await generate(
    prompt,
    {
      responseMimeType: 'application/json',
      responseSchema: schema,
      // Extraction, not composition. The same sentence should produce the same
      // preferences twice — a member re-reading their own instruction and
      // seeing it interpreted differently would rightly stop trusting it.
      temperature: 0,
    },
    // 6s per attempt, not the old 20s (or even the interim 10s) — this backs
    // an interactive chat message with a member watching a typing indicator,
    // and now cycles through up to six attempts (2 models × 3 keys) on
    // failure, not three. Observed live the same night: a hanging attempt
    // sat at its full timeout three times in a row (36s total) before the
    // model swap above even got a turn — a shorter timeout per attempt is
    // what makes cycling through the rest of the pool actually fast instead
    // of just theoretically available. A healthy response has consistently
    // landed in 1-4s in direct testing; 6s is still room for a real answer,
    // not just the floor of a guaranteed-hanging one.
    6000,
  );
  if (!result.ok) return result;
  try {
    return { ok: true, value: JSON.parse(result.text) as T };
  } catch {
    console.error('[gemini] model returned non-JSON despite responseSchema:', result.text.slice(0, 300));
    return { ok: false, reason: 'error' };
  }
}

type GenerateResult = { ok: true; text: string } | { ok: false; reason: ExtractFailureReason };

/** True for Gemini's daily-quota-exhausted shape specifically, so the log
 *  line says what actually happened instead of a generic "failed". Best
 *  effort — if the body doesn't match, this just falls back to logging the
 *  raw status, which is still correct, just less specific. */
function isQuotaExhausted(status: number, bodyText: string): boolean {
  return status === 429 && /RESOURCE_EXHAUSTED|quota/i.test(bodyText);
}

async function generate(
  prompt: string,
  generationConfig: Record<string, unknown> | undefined,
  timeoutMs: number,
): Promise<GenerateResult> {
  if (KEYS.length === 0) return { ok: false, reason: 'unconfigured' };

  const startIndex = rrIndex;
  rrIndex = (rrIndex + 1) % KEYS.length;

  // Sticky, not "last write wins": if ANY attempt showed a real overload/quota
  // signal, that's the honest reason for the whole call even if the LAST one
  // tried happened to fail a different way (e.g. attempt 1 quota-exhausted,
  // attempt 2 a plain network blip) — 'overloaded' is still the true,
  // actionable story, and reporting 'error' instead would wrongly tell the
  // member their phrasing was the problem.
  let sawOverload = false;
  let isFirstAttempt = true;

  for (const model of MODELS) {
    for (let offset = 0; offset < KEYS.length; offset++) {
      const keyIndex = (startIndex + offset) % KEYS.length;
      const key = KEYS[keyIndex];
      const attemptLabel = `${model} key ${keyIndex + 1}/${KEYS.length}`;
      if (!isFirstAttempt) await sleep(INTER_KEY_DELAY_MS);
      isFirstAttempt = false;

      try {
        const res = await fetch(`${endpointFor(model)}?key=${encodeURIComponent(key)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            ...(generationConfig ? { generationConfig } : {}),
          }),
          cache: 'no-store',
          signal: AbortSignal.timeout(timeoutMs),
        });

        if (!res.ok) {
          const bodyText = await res.text().catch(() => '<no body>');
          // 400 is the one status that means "this request is malformed" —
          // identical on every key AND every model, since the prompt/schema
          // is the same each time, so trying the rest would only add latency
          // for a guaranteed-identical failure. Everything else is either
          // explicitly "try again" (503 overloaded, 429 quota-exhausted) or
          // specific to THIS key (401/403 revoked or unauthorized) — both are
          // exactly the signal to move on, not to give up on the whole
          // rotation over one bad or exhausted key or an overloaded model.
          if (res.status === 503 || res.status === 429) sawOverload = true;
          if (res.status === 400) {
            console.error(`[gemini] request malformed (same on every key/model):`, res.status, bodyText.slice(0, 400));
            return { ok: false, reason: 'error' };
          }
          console.error(
            `[gemini] ${attemptLabel} ${isQuotaExhausted(res.status, bodyText) ? 'quota exhausted' : 'failed'}:`,
            res.status, bodyText.slice(0, 400),
          );
          continue;
        }

        const json = await res.json();
        const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (typeof text !== 'string') {
          console.error('[gemini] response had no usable text:', JSON.stringify(json).slice(0, 300));
          return { ok: false, reason: 'error' };
        }
        return { ok: true, text };
      } catch (e) {
        // Network failure or timeout on this attempt — exactly as worth
        // trying the next key/model over as a quota/overload response.
        console.error(`[gemini] ${attemptLabel} request threw:`, e);
        continue;
      }
    }
  }

  // Every model/key combination failed. If any of them showed a real
  // overload/quota signal, say so — that's the honest, actionable reason
  // ('unclear'/'error' framing would be wrong here, see intent.ts's readIntent).
  return { ok: false, reason: sawOverload ? 'overloaded' : 'error' };
}
