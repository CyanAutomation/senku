import type { Environment } from "../../src/contracts/decisions";

export function makeTestEnvironment(prefix = "test"): Environment {
  return {
    OPENROUTER_API_KEY: `${prefix}-openrouter-key`,
    SENKU_KASEKI_API_TOKEN: `${prefix}-kaseki-token-0123456789abcdef`,
    SENKU_SOYUZ_API_TOKEN: `${prefix}-soyuz-token-0123456789abcdef`,
    SENKU_PUBLIC_BASE_URL: "https://senku.scheimann.workers.dev",
    JEV_MODEL: "~typesafe/jev-latest",
    SENKU_PROVIDER_TIMEOUT_MS: "15000",
  };
}
