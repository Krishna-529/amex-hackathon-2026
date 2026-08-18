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

/**
 * A member is watching a countdown while this runs, so it gets a fraction of
 * `explain()`'s budget. `explain()` decorates a page that has already rendered
 * and can afford to be slow; this one sits between "I typed what I want" and
 * "here are better options", and a timeout that outlasts the member's patience
 * is the same as no answer at all.
 */
const JSON_TIMEOUT_MS = 3500;

/**
 * Structured output, for callers that need a value rather than a sentence.
 *
 * Separate from `explain()` on purpose: this one asks for JSON against a
 * declared schema, keeps its own much shorter deadline, and — like `explain()`
 * — collapses every failure to `null` so a missing key, a timeout or a
 * malformed response all degrade the same way. The caller re-validates whatever
 * comes back; `responseSchema` is a request to the model, not a guarantee from
 * it.
 */
export async function generateJson(
  prompt: string,
  responseSchema: unknown,
): Promise<unknown | null> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;

  try {
    const res = await fetch(`${ENDPOINT}?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema,
          temperature: 0,
        },
      }),
      cache: 'no-store',
      signal: AbortSignal.timeout(JSON_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const json = await res.json();
    const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (typeof text !== 'string') return null;
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function explain(prompt: string): Promise<string | null> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;

  try {
    const res = await fetch(
      `${ENDPOINT}?key=${encodeURIComponent(key)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
        cache: 'no-store',
        signal: AbortSignal.timeout(15000),
      },
    );
    if (!res.ok) return null;
    const json = await res.json();
    const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;
    return typeof text === 'string' ? text.trim() : null;
  } catch {
    return null;
  }
}
