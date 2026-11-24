import { ApiError } from "./errors";
import { ProfileEngineError } from "../contracts/profiles";
import { ProviderError, type ProviderDiagnosticCode } from "../providers/openrouter/config";
import type { ProviderFetchFailureClass } from "../providers/openrouter/fetch-diagnostics";
import type { ProviderCauseCode, ProviderErrorType } from "../providers/openrouter/fetch-diagnostics";

const PROFILE_API_ERROR_CODES: Record<ProfileEngineError["code"], ApiError["code"]> = {
  UNKNOWN_PROFILE: "NOT_FOUND",
  DUPLICATE_PROFILE: "INTERNAL_ERROR",
  FORBIDDEN_PROFILE: "FORBIDDEN",
  INVALID_PROFILE_INPUT: "INVALID_REQUEST",
  PROFILE_INPUT_TOO_LARGE: "PAYLOAD_TOO_LARGE",
  INVALID_PROFILE_CONFIGURATION: "INTERNAL_ERROR",
  INVALID_PROFILE_OUTPUT: "INVALID_PROVIDER_RESPONSE",
  NOT_CONFIGURED: "NOT_CONFIGURED",
};

export function profileApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof ProviderError) return new ApiError(error.code, error.retryable);
  if (error instanceof ProfileEngineError) return new ApiError(PROFILE_API_ERROR_CODES[error.code]);
  return new ApiError("INTERNAL_ERROR");
}

export function profileProviderDiagnosticCode(error: unknown): ProviderDiagnosticCode | undefined {
  return profileProviderDiagnostics(error).providerDiagnosticCode;
}

export interface ProfileProviderDiagnostics {
  providerDiagnosticCode?: ProviderDiagnosticCode;
  providerHttpStatus?: number;
  providerRetryable?: boolean;
  providerDurationMs?: number;
  providerFetchFailureClass?: ProviderFetchFailureClass;
  providerErrorType?: ProviderErrorType;
  providerCauseDepth?: number;
  providerCauseCode?: ProviderCauseCode;
}

/** Returns only bounded, allowlisted fields suitable for operational logs. */
export function profileProviderDiagnostics(error: unknown): ProfileProviderDiagnostics {
  if (error instanceof ProviderError) {
    return {
      ...(error.diagnosticCode ? { providerDiagnosticCode: error.diagnosticCode } : {}),
      ...(error.upstreamStatus !== undefined ? { providerHttpStatus: error.upstreamStatus } : {}),
      providerRetryable: error.retryable,
      ...(error.providerDurationMs !== undefined ? { providerDurationMs: error.providerDurationMs } : {}),
      ...(error.providerFetchFailureClass ? { providerFetchFailureClass: error.providerFetchFailureClass } : {}),
      ...(error.providerErrorType ? { providerErrorType: error.providerErrorType } : {}),
      ...(error.providerCauseDepth !== undefined ? { providerCauseDepth: error.providerCauseDepth } : {}),
      ...(error.providerCauseCode ? { providerCauseCode: error.providerCauseCode } : {}),
    };
  }
  if (error instanceof ProfileEngineError && error.code === "INVALID_PROFILE_OUTPUT") {
    return { providerDiagnosticCode: "profile_output_invalid", providerRetryable: false };
  }
  return {};
}
