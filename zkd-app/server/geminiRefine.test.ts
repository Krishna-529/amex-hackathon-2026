import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * No real network calls — fetch is fully mocked. Uses vi.resetModules() +
 * dynamic import per test: geminiRefine.ts's circuit breaker is mutable
 * top-level module state, so each test needs a genuinely fresh module
 * instance rather than one shared across cases (same reasoning as
 * server/bedrock.test.ts, which this file mirrors one-for-one).
 */
const fetchMock = vi.fn();

function geminiResponse(text: string) {
  return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }) };
}

describe('parsePreferencePrompt (Gemini)', () => {
  beforeEach(() => {
    vi.resetModules();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('GEMINI_API_KEY', 'test-key');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('returns null immediately, without attempting a call, when no API key is configured', async () => {
    // Stub to '' rather than unstubAllEnvs(): this dev machine's real
    // .env.local has a working GEMINI_API_KEY (loaded ambiently by vitest),
    // so unstubbing would fall through to that real value instead of unset.
    vi.stubEnv('GEMINI_API_KEY', '');
    const { parsePreferencePrompt } = await import('./geminiRefine');
    const result = await parsePreferencePrompt('arrive before 6pm');
    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns the validated patch on a well-formed JSON response', async () => {
    fetchMock.mockResolvedValue(
      geminiResponse(JSON.stringify({ rationale: 'wants an earlier arrival', arrival_before_local: '18:00' })),
    );
    const { parsePreferencePrompt } = await import('./geminiRefine');
    const result = await parsePreferencePrompt('arrive before 6pm');
    expect(result).toEqual({ rationale: 'wants an earlier arrival', arrival_before_local: '18:00' });
  });

  it('a malformed patch (fails the zod schema) returns null, never throws', async () => {
    fetchMock.mockResolvedValue(geminiResponse(JSON.stringify({ optimization_strategy: 'not-a-real-strategy' })));
    const { parsePreferencePrompt } = await import('./geminiRefine');
    await expect(parsePreferencePrompt('whatever')).resolves.toBeNull();
  });

  it('non-JSON text in the response returns null', async () => {
    fetchMock.mockResolvedValue(geminiResponse('I cannot help with that'));
    const { parsePreferencePrompt } = await import('./geminiRefine');
    await expect(parsePreferencePrompt('whatever')).resolves.toBeNull();
  });

  it('a non-ok HTTP response returns null', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 429, json: async () => ({}) });
    const { parsePreferencePrompt } = await import('./geminiRefine');
    await expect(parsePreferencePrompt('whatever')).resolves.toBeNull();
  });

  it('a rejected/timed-out fetch returns null, never throws', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    const { parsePreferencePrompt } = await import('./geminiRefine');
    await expect(parsePreferencePrompt('whatever')).resolves.toBeNull();
  });

  it('circuit breaker opens after 5 consecutive failures and fast-fails without calling fetch again', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    const { parsePreferencePrompt } = await import('./geminiRefine');
    for (let i = 0; i < 5; i += 1) {
      await expect(parsePreferencePrompt('x')).resolves.toBeNull();
    }
    expect(fetchMock).toHaveBeenCalledTimes(5);

    fetchMock.mockClear();
    await expect(parsePreferencePrompt('x')).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
