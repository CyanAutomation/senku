import type { Environment } from "../../contracts/decisions";

export const DEFAULT_JEV_MODEL = "~typesafe/jev-latest";
export const DEFAULT_PROVIDER_TIMEOUT_MS = 15_000;
export const MIN_PROVIDER_TIMEOUT_MS = 1_000;
export const MAX_PROVIDER_TIMEOUT_MS = 30_000;
const MAX_API_KEY_BYTES = 4_096;

export type ProviderErrorCode = "PROVIDER_TIMEOUT" | "PROVIDER_UNAVAILABLE" | "INVALID_PROVIDER_RESPONSE";
export type ProviderDiagnosticCode =
  | "provider_fetch_failed"
  | "provider_http_error"
  | "provider_unexpected_error"
  | "response_body_missing"
  | "response_body_too_large"
  | "response_body_invalid_json"
  | "response_body_read_failed"
  | "response_content_type_unsupported"
  | "response_envelope_invalid"
  | "response_model_invalid"
  | "response_answer_set_mismatch"
  | "response_answer_invalid"
  | "profile_output_invalid";

export class ProviderError extends Error {
  constructor(
    readonly code: ProviderErrorCode,
    readonly retryable: boolean,
    readonly diagnosticCode?: ProviderDiagnosticCode,
    readonly upstreamStatus?: number,
    readonly providerDurationMs?: number,
  ) {
    super(code);
    this.name = "ProviderError";
  }
}

export type ProviderConfig =
  | { ok: true; apiKey: string; model: string; timeoutMs: number }
  | { ok: false };

export function resolveProviderConfig(env: Environment): ProviderConfig {
  const apiKey = env.OPENROUTER_API_KEY?.trim();
  const configuredModel = env.JEV_MODEL;
  const timeoutValue = env.SENKU_PROVIDER_TIMEOUT_MS?.trim();
  const timeoutMs = timeoutValue ? Number(timeoutValue) : DEFAULT_PROVIDER_TIMEOUT_MS;
  if (!apiKey || new TextEncoder().encode(apiKey).byteLength > MAX_API_KEY_BYTES
    || (configuredModel !== undefined && configuredModel !== DEFAULT_JEV_MODEL)
    || !Number.isInteger(timeoutMs) || timeoutMs < MIN_PROVIDER_TIMEOUT_MS || timeoutMs > MAX_PROVIDER_TIMEOUT_MS) {
    return { ok: false };
  }
  return { ok: true, apiKey, model: DEFAULT_JEV_MODEL, timeoutMs };
}
