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

export async function explain(prompt: string): Promise<string | null> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${encodeURIComponent(key)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
        cache: 'no-store',
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
