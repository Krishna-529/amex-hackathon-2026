/**
 * Gemini REST generateContent. Plain fetch, no SDK — this is a single one-shot
 * text call, not worth a dependency for.
 *
 * Model id note: `gemini-2.5-flash` (the id in round2-api-requirements.csv) is no
 * longer available to new users as of this session — its API error explicitly
 * points at `gemini-flash-latest`, confirmed working here and resolving to
 * `gemini-3.6-flash` server-side. Using the `-latest` alias so this doesn't rot
 * again the next time Google rotates model ids.
 */

const ENDPOINT =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent';

export async function explain(prompt: string): Promise<string | null> {
  const text = await generate(prompt, undefined, 15000);
  return text?.trim() ?? null;
}

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
 *
 * Returns null on any failure — unconfigured key, HTTP error, timeout,
 * unparseable body. `explain()` has always had that contract and callers rely
 * on it: an LLM outage must degrade a feature, never break a recovery.
 */
export async function extractJson<T>(
  prompt: string,
  schema: Record<string, unknown>,
): Promise<T | null> {
  const text = await generate(
    prompt,
    {
      responseMimeType: 'application/json',
      responseSchema: schema,
      // Extraction, not composition. The same sentence should produce the same
      // preferences twice — a member re-reading their own instruction and
      // seeing it interpreted differently would rightly stop trusting it.
      temperature: 0,
    },
    20000,
  );
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

async function generate(
  prompt: string,
  generationConfig: Record<string, unknown> | undefined,
  timeoutMs: number,
): Promise<string | null> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;

  try {
    const res = await fetch(`${ENDPOINT}?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        ...(generationConfig ? { generationConfig } : {}),
      }),
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    const json = await res.json();
    const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;
    return typeof text === 'string' ? text : null;
  } catch {
    return null;
  }
}
