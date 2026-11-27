import { describe, expect, it } from "vitest";
import { SCHEMA_VERSION, type DecisionRequest } from "../src/contracts/decisions";
import { DEFAULT_JEV_MODEL, ProviderError, requestOpenRouterDecision, resolveProviderConfig } from "../src/providers/openrouter/decisions";

// Optional live integration smoke test. The runtime URL and authorization value are supplied by the operator.
const syntheticRequest: DecisionRequest = {
  schemaVersion: SCHEMA_VERSION,
  state: { source: "manual_live_smoke", note: "Synthetic non-sensitive provider compatibility check." },
  questions: {
    smoke_check: {
      type: "noul",
      instructions: "Does this synthetic smoke-test state contain a compatibility-check note?",
      criteria: { true: "The note is present.", false: "The note is absent." },
    },
  },
};

function environment(): Record<string, string | undefined> {
  const processLike = (globalThis as unknown as {
    process?: { env?: Record<string, string | undefined> };
  }).process;
  return processLike?.env ?? {};
}

describe("explicit live provider smoke test", () => {
  it("makes one bounded JEV request and validates the configured provider response", async () => {
    const env = environment();
    const requestUrl = env.SENKU_PROVIDER_REQUEST_URL;
    const authorizationHeader = env.SENKU_PROVIDER_AUTHORIZATION;
    if (!requestUrl || !authorizationHeader) {
      throw new Error("Configure the provider request URL and authorization value before running the live smoke test.");
    }
    const config = resolveProviderConfig({
      SENKU_PROVIDER_REQUEST_URL: requestUrl,
      SENKU_PROVIDER_AUTHORIZATION: authorizationHeader,
      JEV_MODEL: env.JEV_MODEL ?? DEFAULT_JEV_MODEL,
      SENKU_PROVIDER_TIMEOUT_MS: env.SENKU_PROVIDER_TIMEOUT_MS ?? "15000",
    });
    if (!config.ok) throw new Error("Provider smoke-test configuration is invalid.");

    const started = performance.now();
    const result = await requestOpenRouterDecision(syntheticRequest, config).catch((error: unknown) => {
      throw new Error(error instanceof ProviderError ? error.code : "Provider smoke test failed.");
    });
    const durationMs = Math.max(0, Math.round(performance.now() - started));
    console.log(JSON.stringify({
      status: "completed",
      model: result.model,
      durationMs,
      usage: result.usage,
      attemptCount: result.attemptCount,
    }));
    expect(result.model).toMatch(/^typesafe\/jev-/);
    if (env.SENKU_CANARY_EXPECTED_MODEL) expect(result.model).toBe(env.SENKU_CANARY_EXPECTED_MODEL);
    const answer = result.answers.smoke_check;
    expect(answer.type).toBe("noul");
    if (answer.type !== "noul") throw new Error("Live provider returned the wrong answer type.");
    expect(answer.noul).toBeGreaterThanOrEqual(0);
    expect(answer.noul).toBeLessThanOrEqual(1);
    expect(answer.probabilities.true).toBeCloseTo(answer.noul, 12);
    expect(answer.probabilities.false).toBeCloseTo(1 - answer.noul, 12);
  });
});
