import { ProviderError } from "./config";

export interface CircuitBreakerOptions {
  failureThreshold?: number;
  resetAfterMs?: number;
  now?: () => number;
}

/** Best-effort per-isolate protection; it does not coordinate between Worker instances. */
export class BestEffortCircuitBreaker {
  private consecutiveFailures = 0;
  private lastFailureAtMs: number | null = null;
  private openedAtMs: number | null = null;
  private probeInFlight = false;
  private readonly failureThreshold: number;
  private readonly resetAfterMs: number;
  private readonly now: () => number;

  constructor(options: CircuitBreakerOptions = {}) {
    this.failureThreshold = options.failureThreshold ?? 3;
    this.resetAfterMs = options.resetAfterMs ?? 10_000;
    this.now = options.now ?? Date.now;
    if (!Number.isSafeInteger(this.failureThreshold) || this.failureThreshold < 1
      || !Number.isSafeInteger(this.resetAfterMs) || this.resetAfterMs < 1) {
      throw new TypeError("Circuit breaker bounds must be positive integers.");
    }
  }

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    const now = this.now();
    const isProbe = this.openedAtMs !== null;
    if (!isProbe && this.lastFailureAtMs !== null && now - this.lastFailureAtMs >= this.resetAfterMs) {
      this.consecutiveFailures = 0;
    }
    if (isProbe) {
      const retryInMs = this.openedAtMs! + this.resetAfterMs - now;
      if (retryInMs > 0 || this.probeInFlight) throw this.openError(retryInMs > 0 ? retryInMs : this.resetAfterMs);
      this.probeInFlight = true;
    }

    try {
      const result = await operation();
      this.close();
      return result;
    } catch (error) {
      if (error instanceof ProviderError && error.retryable) {
        this.consecutiveFailures += 1;
        this.lastFailureAtMs = this.now();
        if (isProbe || this.consecutiveFailures >= this.failureThreshold) this.openedAtMs = this.lastFailureAtMs;
      } else {
        this.close();
      }
      throw error;
    } finally {
      if (isProbe) this.probeInFlight = false;
    }
  }

  private openError(retryInMs: number): ProviderError {
    return new ProviderError("PROVIDER_UNAVAILABLE", true, {
      attemptCount: 0,
      retryAfterSeconds: Math.max(1, Math.ceil(retryInMs / 1_000)),
    });
  }

  private close(): void {
    this.consecutiveFailures = 0;
    this.lastFailureAtMs = null;
    this.openedAtMs = null;
    this.probeInFlight = false;
  }
}
