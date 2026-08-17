import { describe, expect, it, vi, beforeEach } from 'vitest';
import { CircuitBreaker, CircuitOpenError } from './circuitBreaker';

describe('CircuitBreaker', () => {
  beforeEach(() => vi.useRealTimers());

  it('stays closed and passes through results while calls succeed', async () => {
    const cb = new CircuitBreaker('t', { failureThreshold: 3, cooldownMs: 1000 });
    await expect(cb.execute(async () => 'ok')).resolves.toBe('ok');
    expect(cb.getState()).toBe('closed');
  });

  it('opens after failureThreshold consecutive failures, then fast-fails', async () => {
    const cb = new CircuitBreaker('t', { failureThreshold: 2, cooldownMs: 10_000 });
    const failing = async () => {
      throw new Error('boom');
    };
    await expect(cb.execute(failing)).rejects.toThrow('boom');
    expect(cb.getState()).toBe('closed'); // 1st failure, under threshold
    await expect(cb.execute(failing)).rejects.toThrow('boom');
    expect(cb.getState()).toBe('open'); // 2nd failure, threshold reached

    // Fast-fail: the underlying fn must not even be called while open.
    const spy = vi.fn(async () => 'should not run');
    await expect(cb.execute(spy)).rejects.toThrow(CircuitOpenError);
    expect(spy).not.toHaveBeenCalled();
  });

  it('moves to half-open after cooldown and closes again on a successful trial', async () => {
    vi.useFakeTimers();
    const cb = new CircuitBreaker('t', { failureThreshold: 1, cooldownMs: 5000 });
    await expect(
      cb.execute(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(cb.getState()).toBe('open');

    vi.advanceTimersByTime(5000);
    expect(cb.getState()).toBe('half-open');

    await expect(cb.execute(async () => 'recovered')).resolves.toBe('recovered');
    expect(cb.getState()).toBe('closed');
  });

  it('re-opens immediately if the half-open trial call also fails', async () => {
    vi.useFakeTimers();
    const cb = new CircuitBreaker('t', { failureThreshold: 1, cooldownMs: 1000 });
    await expect(
      cb.execute(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow();
    vi.advanceTimersByTime(1000);
    expect(cb.getState()).toBe('half-open');

    await expect(
      cb.execute(async () => {
        throw new Error('still down');
      }),
    ).rejects.toThrow('still down');
    expect(cb.getState()).toBe('open');
  });
});
