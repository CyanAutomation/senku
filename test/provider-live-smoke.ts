import { describe, expect, it } from "vitest";
import { SCHEMA_VERSION, type DecisionRequest } from "../src/contracts/decisions";
import { DEFAULT_JEV_MODEL, ProviderError, requestOpenRouterDecision, resolveProviderConfig } from "../src/providers/openrouter/decisions";

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

function apiKeyFromEnvironment(): string | undefined {
  const processLike = (globalThis as unknown as {
    process?: { env?: Record<string, string | undefined> };
  }).process;
  return processLike?.env?.OPENROUTER_API_KEY;
}

describe("explicit live OpenRouter provider smoke test", () => {
  it("makes one bounded JEV request and validates the live response", async () => {
    const apiKey = apiKeyFromEnvironment();
    if (!apiKey) throw new Error("Set OPENROUTER_API_KEY before running npm run smoke:provider.");
    const config = resolveProviderConfig({
      OPENROUTER_API_KEY: apiKey,
      JEV_MODEL: DEFAULT_JEV_MODEL,
      SENKU_PROVIDER_TIMEOUT_MS: "15000",
    });
    if (!config.ok) throw new Error("OpenRouter smoke-test configuration is invalid.");

    const started = performance.now();
    try {
      const result = await requestOpenRouterDecision(syntheticRequest, config);
      const durationMs = Math.max(0, Math.round(performance.now() - started));
      console.log(JSON.stringify({
        status: "completed",
        model: result.model,
        durationMs,
        usage: result.usage,
        attemptCount: 1,
      }));
      expect(result.answers.smoke_check.type).toBe("noul");
    } catch (error) {
      throw new Error(error instanceof ProviderError ? error.code : "OpenRouter smoke test failed.");
    }
  });
});
