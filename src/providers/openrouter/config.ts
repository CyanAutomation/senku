import type { Environment } from "../../contracts/decisions";
import type { ProviderFetchFailureClass } from "./fetch-diagnostics";
import type { ProviderCauseCode, ProviderErrorType } from "./fetch-diagnostics";

export const DEFAULT_JEV_MODEL = "~typesafe/jev-latest";
export const ALLOWED_JEV_MODELS = [DEFAULT_JEV_MODEL, "typesafe/jev-1.14-20261014"] as const;
export const DEFAULT_PROVIDER_TIMEOUT_MS = 15_000;
export const MIN_PROVIDER_TIMEOUT_MS = 1_000;
export const MAX_PROVIDER_TIMEOUT_MS = 30_000;
const MAX_PROVIDER_URL_BYTES = 2_048;
const MAX_AUTHORIZATION_HEADER_BYTES = 4_096;

export type ProviderErrorCode = "PROVIDER_TIMEOUT" | "PROVIDER_UNAVAILABLE" | "PROVIDER_RATE_LIMITED" | "INVALID_PROVIDER_RESPONSE";
export type ProviderDiagnosticCode =
  | "provider_fetch_failed"
  | "provider_request_serialization_failed"
  | "provider_request_construction_failed"
  | "provider_http_error"
  | "provider_unexpected_error"
  | "response_processing_failed"
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

export interface ProviderErrorOptions {
  diagnosticCode?: ProviderDiagnosticCode;
  upstreamStatus?: number;
  providerDurationMs?: number;
  providerFetchFailureClass?: ProviderFetchFailureClass;
  providerErrorType?: ProviderErrorType;
  providerCauseDepth?: number;
  providerCauseCode?: ProviderCauseCode;
  retryAfterSeconds?: number;
  attemptCount?: number;
}

export class ProviderError extends Error {
  readonly diagnosticCode?: ProviderDiagnosticCode;
  readonly upstreamStatus?: number;
  readonly providerDurationMs?: number;
  readonly providerFetchFailureClass?: ProviderFetchFailureClass;
  readonly providerErrorType?: ProviderErrorType;
  readonly providerCauseDepth?: number;
  readonly providerCauseCode?: ProviderCauseCode;
  readonly retryAfterSeconds?: number;
  readonly attemptCount: number;

  constructor(
    readonly code: ProviderErrorCode,
    readonly retryable: boolean,
    options: ProviderErrorOptions = {},
  ) {
    super(code);
    this.name = "ProviderError";
    this.diagnosticCode = options.diagnosticCode;
    this.upstreamStatus = options.upstreamStatus;
    this.providerDurationMs = options.providerDurationMs;
    this.providerFetchFailureClass = options.providerFetchFailureClass;
    this.providerErrorType = options.providerErrorType;
    this.providerCauseDepth = options.providerCauseDepth;
    this.providerCauseCode = options.providerCauseCode;
    this.retryAfterSeconds = options.retryAfterSeconds;
    this.attemptCount = options.attemptCount ?? 1;
  }

  withDetails(options: ProviderErrorOptions): ProviderError {
    return new ProviderError(this.code, this.retryable, {
      diagnosticCode: this.diagnosticCode,
      upstreamStatus: this.upstreamStatus,
      providerDurationMs: this.providerDurationMs,
      providerFetchFailureClass: this.providerFetchFailureClass,
      providerErrorType: this.providerErrorType,
      providerCauseDepth: this.providerCauseDepth,
      providerCauseCode: this.providerCauseCode,
      retryAfterSeconds: this.retryAfterSeconds,
      attemptCount: this.attemptCount,
      ...options,
    });
  }
}

export type ProviderConfig =
  | { ok: true; requestUrl: string; authorizationHeader: string; model: string; timeoutMs: number }
  | { ok: false };

export function resolveProviderConfig(env: Environment): ProviderConfig {
  const configuredRequestUrl = env.SENKU_PROVIDER_REQUEST_URL?.trim();
  const authorizationHeader = env.SENKU_PROVIDER_AUTHORIZATION?.trim();
  const requestUrl = resolveSecureRequestUrl(configuredRequestUrl);
  const configuredModel = env.JEV_MODEL;
  const timeoutValue = env.SENKU_PROVIDER_TIMEOUT_MS?.trim();
  const timeoutMs = timeoutValue ? Number(timeoutValue) : DEFAULT_PROVIDER_TIMEOUT_MS;
  if (!requestUrl || !authorizationHeader
    || new TextEncoder().encode(authorizationHeader).byteLength > MAX_AUTHORIZATION_HEADER_BYTES
    || /[\r\n]/.test(authorizationHeader)
    || (configuredModel !== undefined && !ALLOWED_JEV_MODELS.includes(configuredModel as typeof ALLOWED_JEV_MODELS[number]))
    || !Number.isInteger(timeoutMs) || timeoutMs < MIN_PROVIDER_TIMEOUT_MS || timeoutMs > MAX_PROVIDER_TIMEOUT_MS) {
    return { ok: false };
  }
  let authorizationHeaderValue: string;
  try {
    authorizationHeaderValue = new Headers({ authorization: authorizationHeader }).get("authorization") ?? "";
  } catch {
    return { ok: false };
  }
  if (!authorizationHeaderValue) return { ok: false };
  return {
    ok: true,
    requestUrl,
    authorizationHeader: authorizationHeaderValue,
    model: configuredModel ?? DEFAULT_JEV_MODEL,
    timeoutMs,
  };
}

function resolveSecureRequestUrl(value: string | undefined): string | undefined {
  if (!value || new TextEncoder().encode(value).byteLength > MAX_PROVIDER_URL_BYTES) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}
