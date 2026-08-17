/**
 * A generic circuit breaker. Before this, every scorer-call failure in
 * riskModel.ts just try/catched to null/empty-Map — no backoff, so a slow
 * or half-down scoring service got hammered with the full request volume on
 * every single poll, and every caller silently got "no forecast" with no
 * distinction between "never scored" and "was scored fine 40 seconds ago,
 * the service just hiccuped." This gives both: fast-fail once a service is
 * clearly down (stop making it worse) instead of waiting out a fresh
 * multi-second timeout on every call, and a hook (isOpen) callers can use to
 * decide whether last-known-good is worth reaching for.
 *
 * Three states, standard shape: closed (normal) -> open (fast-fail) after
 * `failureThreshold` consecutive failures -> half-open (one trial call
 * allowed) after `cooldownMs` -> closed again on that trial's success, or
 * back to open on its failure.
 */
export type CircuitState = 'closed' | 'open' | 'half-open';

export class CircuitOpenError extends Error {
  constructor(name: string) {
    super(`circuit "${name}" is open — failing fast without calling the underlying service`);
    this.name = 'CircuitOpenError';
  }
}

export type CircuitBreakerOptions = {
  failureThreshold: number;
  cooldownMs: number;
};

export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private consecutiveFailures = 0;
  private openedAtMs = 0;

  constructor(private readonly name: string, private readonly opts: CircuitBreakerOptions) {}

  getState(): CircuitState {
    if (this.state === 'open' && Date.now() - this.openedAtMs >= this.opts.cooldownMs) {
      this.state = 'half-open';
    }
    return this.state;
  }

  isOpen(): boolean {
    return this.getState() === 'open';
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    const state = this.getState();
    if (state === 'open') {
      throw new CircuitOpenError(this.name);
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (e) {
      this.onFailure();
      throw e;
    }
  }

  private onSuccess(): void {
    this.consecutiveFailures = 0;
    this.state = 'closed';
  }

  private onFailure(): void {
    this.consecutiveFailures += 1;
    if (this.state === 'half-open' || this.consecutiveFailures >= this.opts.failureThreshold) {
      this.state = 'open';
      this.openedAtMs = Date.now();
    }
  }
}
