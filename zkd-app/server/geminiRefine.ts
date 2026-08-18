/**
 * The refine LLM: turn a member's free-text preference prompt into a
 * structured patch (server/preferences/refinePatch.ts) that
 * server/engine/refine.ts can safely merge into a re-rank.
 *
 * Was server/bedrock.ts (AWS Bedrock, forced tool-use) until this AWS
 * account hit an account-wide Bedrock/SageMaker restriction ("ValidationException:
 * Operation not allowed") that a support ticket hadn't cleared in time —
 * bedrock.ts is left in place, untouched and still tested, as a one-import-
 * line swap back in server/engine/refine.ts if that ever clears. This reuses
 * the same GEMINI_API_KEY and plain-fetch REST pattern as server/gemini.ts's
 * explain() — proven working from this exact account, since it never talks
 * to AWS at all.
 *
 * Same "absent config → null, never fabricate" discipline as gemini.ts/
 * myca.ts/bedrock.ts: no GEMINI_API_KEY, any network/timeout failure, an
 * open circuit, a non-JSON response, or a response that fails the strict zod
 * schema all return null — never throw, never guess. The caller (refine.ts)
 * falls back to the unmodified deterministic ranking on null, with an honest
 * note. Gemini's own responseSchema below is best-effort decoding guidance
 * only, never trusted directly — PreferencePatchSchema.safeParse() is the
 * real, only safety boundary, exactly as refinePatch.ts's own header
 * documents (the schema has no field that could widen the safety envelope,
 * regardless of which model is asked to fill it in).
 */
import { CircuitBreaker } from './engine/circuitBreaker';
import { PreferencePatchSchema, type PreferencePatch } from './preferences/refinePatch';

const TIMEOUT_MS = 8_000;
// Same `-latest` alias as gemini.ts, same reasoning: model ids rot as Google
// rotates them, the alias doesn't.
const MODEL = 'gemini-flash-latest';

const geminiBreaker = new CircuitBreaker('gemini-refine', { failureThreshold: 5, cooldownMs: 30_000 });

const SYSTEM_PROMPT =
  'A traveler whose flight was disrupted is asking for a different rebooking option in their own ' +
  'words. Extract ONLY the fields you are confident about from what they actually said; leave every ' +
  'other field out of the JSON entirely. Never invent an airline code, a strategy, or a time they did ' +
  'not imply. If the member names an airline in plain language (e.g. "SpiceJet", "IndiGo", "Air ' +
  'India"), convert it to its real 2-letter IATA carrier code (e.g. "SG", "6E", "AI") before adding it ' +
  'to avoid_airlines_add — never pass the airline name itself, that field only accepts codes. Respond ' +
  'with ONLY a single JSON object matching the schema — no prose, no markdown fences.';

// Gemini's structured-output dialect (OpenAPI Schema subset, uppercase Type
// enum) — deliberately not derived from PREFERENCE_PATCH_JSON_SCHEMA
// (bedrock.ts's own JSON-Schema-dialect copy), since the two providers speak
// different schema languages; both are hand-kept in sync with
// PreferencePatchSchema by eye, same as bedrock.ts's own comment explains.
const GEMINI_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    optimization_strategy: {
      type: 'STRING',
      enum: ['earliest_arrival', 'stick_to_preferred_airline', 'minimize_layovers', 'lowest_cost'],
      description: 'Only set if the member clearly implied a change of priority.',
    },
    avoid_airlines_add: {
      type: 'ARRAY',
      items: { type: 'STRING' },
      description: 'IATA carrier codes (2-3 letters) the member wants to avoid, in addition to any already excluded.',
    },
    arrival_before_local: {
      type: 'STRING',
      description: '24h HH:mm local to the destination airport, only if the member gave a specific arrival deadline.',
    },
    max_layovers: {
      type: 'INTEGER',
      description: 'Only if the member asked to reduce connections below what they already have.',
    },
    rationale: {
      type: 'STRING',
      description: 'One short sentence: what you understood from the member and why.',
    },
  },
  required: ['rationale'],
};

/**
 * Returns null on ANY failure — unreachable, timeout, circuit open, non-JSON
 * response, or a response that fails the strict zod schema. Never throws.
 */
export async function parsePreferencePrompt(prompt: string): Promise<PreferencePatch | null> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;

  try {
    return await geminiBreaker.execute(async () => {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(key)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
            // thinkingBudget: 0 — this is narrow entity extraction, not a
            // reasoning task; Gemini 3's default chain-of-thought here was
            // observed adding enough latency (hundreds of "thinking" tokens)
            // to occasionally miss the timeout below entirely.
            generationConfig: {
              responseMimeType: 'application/json',
              responseSchema: GEMINI_RESPONSE_SCHEMA,
              thinkingConfig: { thinkingBudget: 0 },
            },
          }),
          cache: 'no-store',
          signal: AbortSignal.timeout(TIMEOUT_MS),
        },
      );
      if (!res.ok) throw new Error(`Gemini responded ${res.status}`);

      const json = await res.json();
      const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (typeof text !== 'string') throw new Error('no text in Gemini response');

      const parsed = PreferencePatchSchema.safeParse(JSON.parse(text));
      if (!parsed.success) throw new Error(`invalid preference patch shape: ${parsed.error.message}`);
      return parsed.data;
    });
  } catch {
    return null;
  }
}
