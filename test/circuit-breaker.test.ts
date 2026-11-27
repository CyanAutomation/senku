import { describe, expect, it } from "vitest";
import { BestEffortCircuitBreaker } from "../src/providers/openrouter/circuit-breaker";
import { ProviderError } from "../src/providers/openrouter/decisions";

describe("best-effort provider circuit breaker", () => {
  it("opens after repeated transient failures and permits a probe after cooldown", async () => {
    let now = 1_000;
    let calls = 0;
    const breaker = new BestEffortCircuitBreaker({ failureThreshold: 2, resetAfterMs: 5_000, now: () => now });
    const failingOperation = async () => {
      calls += 1;
      throw new ProviderError("PROVIDER_UNAVAILABLE", true);
    };

    await expect(breaker.execute(failingOperation)).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
    await expect(breaker.execute(failingOperation)).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
    await expect(breaker.execute(failingOperation)).rejects.toMatchObject({ attemptCount: 0, retryAfterSeconds: 5 });
    expect(calls).toBe(2);

    now += 5_000;
    await expect(breaker.execute(async () => "recovered")).resolves.toBe("recovered");
    await expect(breaker.execute(async () => "closed")).resolves.toBe("closed");
  });

  it("allows only one half-open probe at a time", async () => {
    let now = 0;
    const breaker = new BestEffortCircuitBreaker({ failureThreshold: 1, resetAfterMs: 1_000, now: () => now });
    await expect(breaker.execute(async () => { throw new ProviderError("PROVIDER_TIMEOUT", true); })).rejects.toBeInstanceOf(ProviderError);
    now = 1_000;

    let finishProbe: ((value: string) => void) | undefined;
    const probe = breaker.execute(() => new Promise<string>((resolve) => { finishProbe = resolve; }));
    await Promise.resolve();
    await expect(breaker.execute(async () => "duplicate")).rejects.toMatchObject({ attemptCount: 0 });
    finishProbe?.("recovered");
    await expect(probe).resolves.toBe("recovered");
  });

  it("does not accumulate failures from separate cooldown windows", async () => {
    let now = 0;
    let calls = 0;
    const breaker = new BestEffortCircuitBreaker({ failureThreshold: 2, resetAfterMs: 1_000, now: () => now });
    const failingOperation = async () => {
      calls += 1;
      throw new ProviderError("PROVIDER_UNAVAILABLE", true);
    };

    await expect(breaker.execute(failingOperation)).rejects.toBeInstanceOf(ProviderError);
    now = 1_000;
    await expect(breaker.execute(failingOperation)).rejects.toBeInstanceOf(ProviderError);
    await expect(breaker.execute(async () => "still closed")).resolves.toBe("still closed");
    expect(calls).toBe(2);
  });

  it("does not trip for nonretryable provider errors", async () => {
    const breaker = new BestEffortCircuitBreaker({ failureThreshold: 1 });
    await expect(breaker.execute(async () => {
      throw new ProviderError("INVALID_PROVIDER_RESPONSE", false);
    })).rejects.toMatchObject({ code: "INVALID_PROVIDER_RESPONSE" });
    await expect(breaker.execute(async () => "next request runs")).resolves.toBe("next request runs");
  });
});
