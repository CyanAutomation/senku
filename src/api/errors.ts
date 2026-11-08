import type { ErrorCode, ErrorResponse } from "../contracts/decisions";

const messages: Record<ErrorCode, string> = {
  INVALID_REQUEST: "The request is not valid for schema version 1.",
  UNAUTHENTICATED: "A valid bearer token is required.",
  FORBIDDEN: "The authenticated client is not permitted to use this endpoint.",
  PAYLOAD_TOO_LARGE: "The request body exceeds the configured size limit.",
  UNSUPPORTED_SCHEMA_VERSION: "The requested schema version is not supported.",
  NOT_CONFIGURED: "The decision service is not configured.",
  PROVIDER_TIMEOUT: "The decision provider did not respond before the timeout.",
  PROVIDER_UNAVAILABLE: "The decision provider is unavailable.",
  INVALID_PROVIDER_RESPONSE: "The decision provider returned an invalid response.",
  NOT_FOUND: "The requested route was not found.",
  INTERNAL_ERROR: "An internal error occurred.",
};

const statusCodes: Record<ErrorCode, number> = {
  INVALID_REQUEST: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_SCHEMA_VERSION: 400,
  NOT_CONFIGURED: 503,
  PROVIDER_TIMEOUT: 504,
  PROVIDER_UNAVAILABLE: 502,
  INVALID_PROVIDER_RESPONSE: 502,
  NOT_FOUND: 404,
  INTERNAL_ERROR: 500,
};

export class ApiError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly retryable = false,
    readonly status = statusCodes[code],
  ) {
    super(messages[code]);
    this.name = "ApiError";
  }
}

export function errorResponse(error: ApiError, requestId: string): Response {
  const body: ErrorResponse = {
    error: {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      requestId,
    },
  };
  return new Response(JSON.stringify(body), {
    status: error.status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
