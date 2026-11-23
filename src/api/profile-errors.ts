import { ApiError } from "./errors";
import { ProfileEngineError } from "../contracts/profiles";
import { ProviderError, type ProviderDiagnosticCode } from "../providers/openrouter/config";

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
  if (error instanceof ProviderError) return error.diagnosticCode;
  if (error instanceof ProfileEngineError && error.code === "INVALID_PROFILE_OUTPUT") return "profile_output_invalid";
  return undefined;
}
