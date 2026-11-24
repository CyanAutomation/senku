import { describe, expect, it } from "vitest";
import { ApiError } from "../src/api/errors";
import { profileApiError, profileProviderDiagnosticCode, profileProviderDiagnostics } from "../src/api/profile-errors";
import { ProfileEngineError } from "../src/contracts/profiles";
import { ProviderError } from "../src/providers/openrouter/config";

describe("profile error mapping", () => {
  it.each([
    ["UNKNOWN_PROFILE", "NOT_FOUND"],
    ["DUPLICATE_PROFILE", "INTERNAL_ERROR"],
    ["FORBIDDEN_PROFILE", "FORBIDDEN"],
    ["INVALID_PROFILE_INPUT", "INVALID_REQUEST"],
    ["PROFILE_INPUT_TOO_LARGE", "PAYLOAD_TOO_LARGE"],
    ["INVALID_PROFILE_CONFIGURATION", "INTERNAL_ERROR"],
    ["INVALID_PROFILE_OUTPUT", "INVALID_PROVIDER_RESPONSE"],
    ["NOT_CONFIGURED", "NOT_CONFIGURED"],
  ] as const)("maps %s to %s", (profileCode, apiCode) => {
    expect(profileApiError(new ProfileEngineError(profileCode))).toMatchObject({ code: apiCode, retryable: false });
  });

  it("preserves existing API errors and provider retryability", () => {
    const apiError = new ApiError("FORBIDDEN");
    expect(profileApiError(apiError)).toBe(apiError);
    expect(profileApiError(new ProviderError("PROVIDER_TIMEOUT", true))).toMatchObject({
      code: "PROVIDER_TIMEOUT",
      retryable: true,
    });
    expect(profileApiError(new Error("unexpected"))).toMatchObject({ code: "INTERNAL_ERROR", retryable: false });
  });

  it("preserves provider diagnostics and identifies invalid profile output", () => {
    const providerError = new ProviderError("INVALID_PROVIDER_RESPONSE", false, "response_answer_invalid", 401, 17, "connection");
    expect(profileProviderDiagnosticCode(providerError)).toBe("response_answer_invalid");
    expect(profileProviderDiagnostics(providerError)).toEqual({
      providerDiagnosticCode: "response_answer_invalid",
      providerHttpStatus: 401,
      providerRetryable: false,
      providerDurationMs: 17,
      providerFetchFailureClass: "connection",
    });
    expect(profileProviderDiagnosticCode(new ProfileEngineError("INVALID_PROFILE_OUTPUT"))).toBe("profile_output_invalid");
    expect(profileProviderDiagnosticCode(new ProfileEngineError("INVALID_PROFILE_INPUT"))).toBeUndefined();
    expect(profileProviderDiagnosticCode(new Error("unexpected"))).toBeUndefined();
    expect(profileProviderDiagnostics(new Error("private details"))).toEqual({});
  });
});
