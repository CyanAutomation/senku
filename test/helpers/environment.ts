import type { Environment } from "../../src/contracts/decisions";

export function makeTestEnvironment(prefix = "test"): Environment {
  const rateLimit = { limit: async () => ({ success: true }) };
  return {
    SENKU_PROVIDER_REQUEST_URL: "https://provider.example.invalid/api/v1/decisions",
    SENKU_PROVIDER_AUTHORIZATION: `TestCredential ${prefix}-provider-authorization`,
    SENKU_KASEKI_API_TOKEN: `${prefix}-kaseki-token-0123456789abcdef`,
    SENKU_SOYUZ_API_TOKEN: `${prefix}-soyuz-token-0123456789abcdef`,
    SENKU_RUSTY_FOSSIL_API_TOKEN: `${prefix}-rusty-fossil-token-0123456789abcdef`,
    SENKU_PUBLIC_BASE_URL: "https://service.example.invalid",
    JEV_MODEL: "~typesafe/jev-latest",
    SENKU_PROVIDER_TIMEOUT_MS: "15000",
    SENKU_RATE_LIMIT_IP: rateLimit,
    SENKU_RATE_LIMIT_KASEKI: rateLimit,
    SENKU_RATE_LIMIT_SOYUZ: rateLimit,
    SENKU_RATE_LIMIT_RUSTY_FOSSIL: rateLimit,
  };
}
