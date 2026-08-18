import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * No real AWS calls — the SDK is fully mocked. Uses vi.resetModules() +
 * dynamic import per test: bedrock.ts's circuit breaker is mutable
 * top-level module state, so each test needs a genuinely fresh module
 * instance rather than one shared across cases (same reasoning as
 * lib/thresholdConfig.test.ts / forecastEventRescore.test.ts).
 */
const sendMock = vi.fn();
// vi.fn().mockImplementation MUST use `function`, not an arrow function, when
// the mock is invoked with `new` (as bedrock.ts does for both of these) — an
// arrow function can't be constructed and vitest silently falls back to
// calling it plain, so `new BedrockRuntimeClient()` would never actually
// pick up the returned `{send: sendMock}` object.
vi.mock('@aws-sdk/client-bedrock-runtime', () => ({
  BedrockRuntimeClient: vi.fn().mockImplementation(function BedrockRuntimeClient() {
    return { send: sendMock };
  }),
  ConverseCommand: vi.fn().mockImplementation(function ConverseCommand(input: unknown) {
    return { input };
  }),
}));

function toolUseResponse(input: unknown) {
  return { output: { message: { content: [{ toolUse: { input } }] } } };
}

describe('parsePreferencePrompt', () => {
  beforeEach(() => {
    vi.resetModules();
    sendMock.mockReset();
    vi.stubEnv('BEDROCK_INFERENCE_PROFILE_ARN', 'arn:aws:bedrock:ap-south-1::inference-profile/test');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns null immediately, without attempting a client, when no inference profile ARN is configured', async () => {
    vi.unstubAllEnvs();
    const { parsePreferencePrompt } = await import('./bedrock');
    const result = await parsePreferencePrompt('arrive before 6pm');
    expect(result).toBeNull();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('returns the validated patch on a well-formed tool-use response', async () => {
    sendMock.mockResolvedValue(toolUseResponse({ rationale: 'wants an earlier arrival', arrival_before_local: '18:00' }));
    const { parsePreferencePrompt } = await import('./bedrock');
    const result = await parsePreferencePrompt('arrive before 6pm');
    expect(result).toEqual({ rationale: 'wants an earlier arrival', arrival_before_local: '18:00' });
  });

  it('a malformed tool-use response (fails the zod schema) returns null, never throws', async () => {
    sendMock.mockResolvedValue(toolUseResponse({ optimization_strategy: 'not-a-real-strategy' })); // also missing required rationale
    const { parsePreferencePrompt } = await import('./bedrock');
    await expect(parsePreferencePrompt('whatever')).resolves.toBeNull();
  });

  it('a response with no tool-use block returns null', async () => {
    sendMock.mockResolvedValue({ output: { message: { content: [{ text: 'I cannot help with that' }] } } });
    const { parsePreferencePrompt } = await import('./bedrock');
    await expect(parsePreferencePrompt('whatever')).resolves.toBeNull();
  });

  it('a rejected/timed-out send() returns null, never throws', async () => {
    sendMock.mockRejectedValue(new Error('ECONNREFUSED'));
    const { parsePreferencePrompt } = await import('./bedrock');
    await expect(parsePreferencePrompt('whatever')).resolves.toBeNull();
  });

  it('circuit breaker opens after 5 consecutive failures and fast-fails without calling send() again', async () => {
    sendMock.mockRejectedValue(new Error('ECONNREFUSED'));
    const { parsePreferencePrompt } = await import('./bedrock');
    for (let i = 0; i < 5; i += 1) {
      await expect(parsePreferencePrompt('x')).resolves.toBeNull();
    }
    expect(sendMock).toHaveBeenCalledTimes(5);

    sendMock.mockClear();
    await expect(parsePreferencePrompt('x')).resolves.toBeNull();
    expect(sendMock).not.toHaveBeenCalled();
  });
});
