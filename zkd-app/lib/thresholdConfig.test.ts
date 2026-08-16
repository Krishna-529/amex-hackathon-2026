import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Regression coverage for a real bug: refreshThresholdConfigIfStale() (the
 * function meant to pull the adaptive-threshold config from AWS AppConfig in
 * production) was exported but never called from anywhere, and
 * getThresholdConfig() only ever read the local bundled file — so with
 * THRESHOLD_CONFIG_URL set (the real production wiring, see
 * zkd-risk-model/infra/appconfig.tf), AppConfig was never actually read at
 * all; every request silently served whatever risk-thresholds.json shipped
 * in the deployed image, forever. Fixed by making getThresholdConfig()
 * self-drive the remote refresh and keeping the remote/local caches
 * separate so a stale-local-file re-read can never clobber a fresh remote
 * value.
 *
 * Uses vi.resetModules() + dynamic import per test: the module under test
 * keeps mutable top-level cache state, so each test needs a genuinely fresh
 * module instance rather than one shared across cases.
 */
describe('getThresholdConfig — remote (AppConfig) vs local file', () => {
  const REMOTE_URL = 'http://appconfig.test/thresholds';

  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('with no THRESHOLD_CONFIG_URL, reads the local bundled file and never calls fetch', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const { getThresholdConfig } = await import('./thresholdConfig');
    const cfg = getThresholdConfig();
    expect(cfg.version).toBeTypeOf('number');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('with THRESHOLD_CONFIG_URL set, a call to getThresholdConfig triggers the remote fetch itself — no separate wiring required', async () => {
    vi.stubEnv('THRESHOLD_CONFIG_URL', REMOTE_URL);
    const remoteConfigValue = { version: 999 }; // distinguishable from the local file's real version
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify(remoteConfigValue), { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);

    const { getThresholdConfig } = await import('./thresholdConfig');
    // First call: remote hasn't resolved yet (fire-and-forget), so it falls
    // back to the local file for THIS call, but must have kicked off the fetch.
    getThresholdConfig();
    expect(fetchSpy).toHaveBeenCalledWith(REMOTE_URL, expect.anything());

    // Let the in-flight fetch resolve.
    await new Promise((r) => setTimeout(r, 0));

    // Second call now gets the remote value, not the local file.
    const cfg = getThresholdConfig();
    expect((cfg as unknown as { version: number }).version).toBe(999);
  });

  it('once a remote value has loaded, re-reading the local file (e.g. after the reload window elapses) does NOT clobber it', async () => {
    vi.useFakeTimers();
    vi.stubEnv('THRESHOLD_CONFIG_URL', REMOTE_URL);
    const remoteConfigValue = { version: 999 };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(remoteConfigValue), { status: 200 })));

    const { getThresholdConfig } = await import('./thresholdConfig');
    getThresholdConfig();
    await vi.runOnlyPendingTimersAsync().catch(() => {}); // let the fetch microtask settle under fake timers
    await Promise.resolve();
    await Promise.resolve();

    const first = getThresholdConfig();
    expect((first as unknown as { version: number }).version).toBe(999);

    // Advance well past the 30s reload window — this used to re-read the
    // bundled local file into the SAME cache slot the remote value lived
    // in, silently reverting to it.
    vi.advanceTimersByTime(60_000);
    const second = getThresholdConfig();
    expect((second as unknown as { version: number }).version).toBe(999);

    vi.useRealTimers();
  });

  it('falls back to the local file if the remote fetch fails, rather than throwing', async () => {
    vi.stubEnv('THRESHOLD_CONFIG_URL', REMOTE_URL);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));

    const { getThresholdConfig } = await import('./thresholdConfig');
    const cfg = getThresholdConfig();
    expect(cfg.version).toBeTypeOf('number'); // the real local file's version, not a crash
  });
});
