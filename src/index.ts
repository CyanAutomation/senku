import { areMachineTokenCredentialsDistinct, authenticateBearer, type AuthenticationResult } from "./auth/bearer";
import { canEvaluateProfile, canUseGenericDecisions, type ClientIdentity } from "./auth/permissions";
import { ApiError, errorResponse } from "./api/errors";
import { serializeOpenApiDocument } from "./api/openapi";
import { getPublicProfileContract, listPublicProfiles } from "./api/profile-contracts";
import { serializeUtcpManual, trustedSenkuOrigin } from "./api/utcp";
import { validateDecisionRequest } from "./contracts/validation";
import { LIMITS, type DecisionResponse, type Environment } from "./contracts/decisions";
import { ProfileEngineError } from "./contracts/profiles";
import { evaluateProfile } from "./decisions/profile-engine";
import { profileRegistry, type RegisteredProfileId } from "./decisions/profile-registry";
import {
  DEFAULT_PROVIDER_TIMEOUT_MS,
  MAX_PROVIDER_TIMEOUT_MS,
  MIN_PROVIDER_TIMEOUT_MS,
  ProviderError,
  requestOpenRouterDecision,
  resolveProviderConfig,
  type ProviderDiagnosticCode,
} from "./providers/openrouter/decisions";
import { consoleLogger, safeLog, type Logger } from "./observability/log";

export interface WorkerDependencies {
  fetchImpl?: typeof fetch;
  logger?: Logger;
  /** Test seam for mapping manual-generation failures through the Worker error contract. */
  serializeUtcpManual?: typeof serializeUtcpManual;
  /** Trusted internal identity seam for future server-side callers; never populated from request data. */
  resolveIdentity?: (request: Request, env: Environment) => Promise<AuthenticationResult>;
}

function jsonResponse(value: unknown, status = 200): Response {
  return serializedJsonResponse(JSON.stringify(value), status);
}

function serializedJsonResponse(value: string, status = 200): Response {
  return new Response(value, {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function requestId(): string {
  return "dec-" + crypto.randomUUID();
}

function elapsedMs(started: number): number {
  return Math.max(0, Math.round(performance.now() - started));
}

function timeoutIsStructurallyValid(env: Environment): boolean {
  const raw = env.SENKU_PROVIDER_TIMEOUT_MS?.trim();
  const value = raw ? Number(raw) : DEFAULT_PROVIDER_TIMEOUT_MS;
  return Number.isInteger(value) && value >= MIN_PROVIDER_TIMEOUT_MS && value <= MAX_PROVIDER_TIMEOUT_MS;
}

function ready(env: Environment): boolean {
  return areMachineTokenCredentialsDistinct(env)
    && trustedSenkuOrigin(env.SENKU_PUBLIC_BASE_URL) !== null
    && resolveProviderConfig(env).ok
    && timeoutIsStructurallyValid(env);
}

function hasJsonContentType(request: Request): boolean {
  const contentType = request.headers.get("content-type");
  return Boolean(contentType && /^\s*application\/json(?:\s*;\s*charset=utf-8)?\s*$/i.test(contentType));
}

async function readBoundedRequest(request: Request): Promise<{ bytes: Uint8Array; size: number }> {
  const length = request.headers.get("content-length");
  if (length && /^\d+$/.test(length) && Number(length) > LIMITS.requestBytes) {
    throw new ApiError("PAYLOAD_TOO_LARGE");
  }
  if (!request.body) return { bytes: new Uint8Array(), size: 0 };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      size += item.value.byteLength;
      if (size > LIMITS.requestBytes) {
        await reader.cancel().catch(() => undefined);
        throw new ApiError("PAYLOAD_TOO_LARGE");
      }
      chunks.push(item.value);
    }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError("INVALID_REQUEST");
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { bytes, size };
}

function parseJson(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw new ApiError("INVALID_REQUEST");
  }
}

function logFailure(
  logger: Logger,
  details: {
    requestId: string;
    clientId?: string;
    error: ApiError;
    method: string;
    path: string;
    requestBytes?: number;
    questionCount?: number;
    workerDurationMs: number;
    providerDurationMs?: number;
    attemptCount?: number;
    profileId?: string;
    providerDiagnosticCode?: ProviderDiagnosticCode;
    event?: string;
  },
): void {
  safeLog(logger, {
    event: details.event ?? "decision.request_failed",
    requestId: details.requestId,
    clientId: details.clientId ?? "unknown",
    status: details.error.code,
    errorCode: details.error.code,
    method: details.method,
    path: details.path,
    requestBytes: details.requestBytes,
    questionCount: details.questionCount,
    providerDurationMs: details.providerDurationMs,
    providerDiagnosticCode: details.providerDiagnosticCode,
    workerDurationMs: details.workerDurationMs,
    attemptCount: details.attemptCount ?? 0,
    profileId: details.profileId,
  });
}

function internalRouteFailure(
  logger: Logger,
  details: {
    requestId: string;
    clientId: ClientIdentity;
    request: Request;
    path: string;
    started: number;
  },
): Response {
  const error = new ApiError("INTERNAL_ERROR");
  logFailure(logger, {
    requestId: details.requestId,
    clientId: details.clientId,
    error,
    method: details.request.method,
    path: details.path,
    workerDurationMs: elapsedMs(details.started),
    event: "profile.request_failed",
  });
  return errorResponse(error, details.requestId);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function profileIdFromPath(value: string): string | null {
  try {
    const decoded = decodeURIComponent(value);
    return /^[a-z][a-z0-9_]{0,63}$/.test(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

function profileApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof ProviderError) return new ApiError(error.code, error.retryable);
  if (error instanceof ProfileEngineError) {
    switch (error.code) {
      case "UNKNOWN_PROFILE": return new ApiError("NOT_FOUND");
      case "FORBIDDEN_PROFILE": return new ApiError("FORBIDDEN");
      case "INVALID_PROFILE_INPUT": return new ApiError("INVALID_REQUEST");
      case "PROFILE_INPUT_TOO_LARGE": return new ApiError("PAYLOAD_TOO_LARGE");
      case "INVALID_PROFILE_CONFIGURATION": return new ApiError("INTERNAL_ERROR");
      case "INVALID_PROFILE_OUTPUT": return new ApiError("INVALID_PROVIDER_RESPONSE");
      case "NOT_CONFIGURED": return new ApiError("NOT_CONFIGURED");
      case "DUPLICATE_PROFILE": return new ApiError("INTERNAL_ERROR");
    }
  }
  return new ApiError("INTERNAL_ERROR");
}

function profileProviderDiagnosticCode(error: unknown): ProviderDiagnosticCode | undefined {
  if (error instanceof ProviderError) return error.diagnosticCode;
  if (error instanceof ProfileEngineError && error.code === "INVALID_PROFILE_OUTPUT") return "profile_output_invalid";
  return undefined;
}

function profileInputFromEnvelope(value: unknown): unknown {
  if (!isRecord(value)) throw new ApiError("INVALID_REQUEST");
  if (typeof value.schemaVersion === "string" && value.schemaVersion !== "1") {
    throw new ApiError("UNSUPPORTED_SCHEMA_VERSION");
  }
  if (value.schemaVersion !== "1" || !Object.hasOwn(value, "input")
    || Object.keys(value).some((key) => key !== "schemaVersion" && key !== "input")) {
    throw new ApiError("INVALID_REQUEST");
  }
  return value.input;
}

function authError(authentication: Exclude<AuthenticationResult, { authenticated: true }>): ApiError {
  return new ApiError(authentication.reason === "not_configured" ? "NOT_CONFIGURED" : "UNAUTHENTICATED");
}

export function createWorker(dependencies: WorkerDependencies = {}): {
  fetch(request: Request, env: Environment): Promise<Response>;
} {
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const logger = dependencies.logger ?? consoleLogger;
  const serializeManual = dependencies.serializeUtcpManual ?? serializeUtcpManual;
  const resolveIdentity = dependencies.resolveIdentity
    ?? ((request: Request, env: Environment) => authenticateBearer(request.headers.get("authorization"), env));

  return {
    async fetch(request: Request, env: Environment): Promise<Response> {
      const started = performance.now();
      const id = requestId();
      const url = new URL(request.url);

      if (url.pathname === "/healthz") {
        if (request.method !== "GET") {
          const error = new ApiError("INVALID_REQUEST", false, 405);
          const response = errorResponse(error, id);
          response.headers.set("allow", "GET");
          return response;
        }
        return jsonResponse({ status: "ok" });
      }

      if (url.pathname === "/readyz") {
        if (request.method !== "GET") {
          const error = new ApiError("INVALID_REQUEST", false, 405);
          const response = errorResponse(error, id);
          response.headers.set("allow", "GET");
          return response;
        }
        const isReady = ready(env);
        return jsonResponse({ status: isReady ? "ready" : "not_ready" }, isReady ? 200 : 503);
      }

      const profileEvaluationMatch = /^\/v1\/profiles\/([^/]+)\/evaluate$/.exec(url.pathname);
      const profileDetailMatch = /^\/v1\/profiles\/([^/]+)$/.exec(url.pathname);
      const isProfileList = url.pathname === "/v1/profiles";
      const isOpenApi = url.pathname === "/openapi.json";
      const isUtcp = url.pathname === "/utcp";
      if (isProfileList || profileDetailMatch || profileEvaluationMatch || isOpenApi || isUtcp) {
        const expectedMethod = profileEvaluationMatch ? "POST" : "GET";
        const logPath = isProfileList
          ? "/v1/profiles"
          : isOpenApi
            ? "/openapi.json"
            : isUtcp
              ? "/utcp"
            : profileEvaluationMatch
              ? "/v1/profiles/{profileId}/evaluate"
              : "/v1/profiles/{profileId}";
        if (request.method !== expectedMethod) {
          const error = new ApiError("INVALID_REQUEST", false, 405);
          const response = errorResponse(error, id);
          response.headers.set("allow", expectedMethod);
          return response;
        }

        const authentication = await resolveIdentity(request, env);
        if (!authentication.authenticated) {
          const error = authError(authentication);
          logFailure(logger, {
            requestId: id,
            error,
            method: request.method,
            path: logPath,
            workerDurationMs: elapsedMs(started),
            event: "profile.request_failed",
          });
          return errorResponse(error, id);
        }

        if (isProfileList) {
          return jsonResponse({ schemaVersion: "1", profiles: listPublicProfiles(authentication.clientId) });
        }
        if (isOpenApi) {
          try {
            return serializedJsonResponse(serializeOpenApiDocument(authentication.clientId));
          } catch {
            return internalRouteFailure(logger, {
              requestId: id,
              clientId: authentication.clientId,
              request,
              path: logPath,
              started,
            });
          }
        }
        if (isUtcp) {
          try {
            const manual = serializeManual(authentication.clientId, env.SENKU_PUBLIC_BASE_URL);
            return manual
              ? serializedJsonResponse(manual)
              : errorResponse(new ApiError("NOT_CONFIGURED"), id);
          } catch {
            return internalRouteFailure(logger, {
              requestId: id,
              clientId: authentication.clientId,
              request,
              path: logPath,
              started,
            });
          }
        }

        const profileId = profileIdFromPath((profileDetailMatch ?? profileEvaluationMatch)![1]);
        if (!profileId) {
          const error = new ApiError("INVALID_REQUEST");
          logFailure(logger, {
            requestId: id,
            clientId: authentication.clientId,
            error,
            method: request.method,
            path: logPath,
            workerDurationMs: elapsedMs(started),
            event: "profile.request_failed",
          });
          return errorResponse(error, id);
        }

        if (!canEvaluateProfile(profileId, authentication.clientId)) {
          const error = new ApiError("FORBIDDEN");
          logFailure(logger, {
            requestId: id,
            clientId: authentication.clientId,
            error,
            method: request.method,
            path: logPath,
            workerDurationMs: elapsedMs(started),
            event: "profile.request_failed",
          });
          return errorResponse(error, id);
        }

        let profile;
        try {
          profile = profileRegistry.getProfile(profileId);
        } catch (error) {
          const apiError = profileApiError(error);
          logFailure(logger, {
            requestId: id,
            clientId: authentication.clientId,
            error: apiError,
            method: request.method,
            path: logPath,
            workerDurationMs: elapsedMs(started),
            event: "profile.request_failed",
          });
          return errorResponse(apiError, id);
        }

        if (profileDetailMatch) return jsonResponse(getPublicProfileContract(profileId));

        if (!hasJsonContentType(request)) {
          const error = new ApiError("INVALID_REQUEST", false, 415);
          logFailure(logger, {
            requestId: id,
            clientId: authentication.clientId,
            error,
            method: request.method,
            path: logPath,
            profileId,
            workerDurationMs: elapsedMs(started),
            event: "profile.evaluation_failed",
          });
          return errorResponse(error, id);
        }

        let requestBytes = 0;
        let providerAttempts = 0;
        const questionCount = profile.maxQuestionCount ?? Object.keys(profile.questions).length;
        const trackedFetch: typeof fetch = (input, init) => {
          providerAttempts += 1;
          return fetchImpl(input, init);
        };
        try {
          const input = await readBoundedRequest(request);
          requestBytes = input.size;
          const profileInput = profileInputFromEnvelope(parseJson(input.bytes));
          const result = await evaluateProfile(profileId as RegisteredProfileId, profileInput, {
            clientIdentity: authentication.clientId,
          }, { env, fetchImpl: trackedFetch });
          const response = {
            schemaVersion: "1",
            requestId: id,
            status: "completed",
            profileId: result.profileId,
            profileVersion: result.profileVersion,
            provider: "jev",
            model: result.model,
            answers: result.answers,
            result: result.result,
            ...(result.metadata.usage ? { usage: result.metadata.usage } : {}),
            durationMs: result.metadata.providerDurationMs,
            attemptCount: result.metadata.attemptCount,
          };
          safeLog(logger, {
            event: "profile.evaluation_completed",
            requestId: id,
            clientId: authentication.clientId,
            profileId: result.profileId,
            profileVersion: result.profileVersion,
            status: "completed",
            method: request.method,
            path: logPath,
            model: result.model,
            questionCount: result.metadata.questionCount,
            evidenceBytes: result.metadata.evidenceBytes,
            requestBytes,
            providerDurationMs: result.metadata.providerDurationMs,
            workerDurationMs: elapsedMs(started),
            attemptCount: result.metadata.attemptCount,
            ...(result.metadata.usage ? { usage: result.metadata.usage } : {}),
          });
          return jsonResponse(response);
        } catch (error) {
          const apiError = profileApiError(error);
          logFailure(logger, {
            requestId: id,
            clientId: authentication.clientId,
            error: apiError,
            method: request.method,
            path: logPath,
            requestBytes,
            questionCount,
            attemptCount: providerAttempts,
            profileId,
            workerDurationMs: elapsedMs(started),
            event: "profile.evaluation_failed",
            providerDiagnosticCode: profileProviderDiagnosticCode(error),
          });
          return errorResponse(apiError, id);
        }
      }

      if (url.pathname !== "/v1/decisions") {
        const error = new ApiError("NOT_FOUND");
        return errorResponse(error, id);
      }

      if (request.method !== "POST") {
        const error = new ApiError("INVALID_REQUEST", false, 405);
        const response = errorResponse(error, id);
        response.headers.set("allow", "POST");
        return response;
      }

      const authentication = await resolveIdentity(request, env);
      if (!authentication.authenticated) {
        const error = authError(authentication);
        logFailure(logger, {
          requestId: id,
          error,
          method: request.method,
          path: url.pathname,
          workerDurationMs: elapsedMs(started),
        });
        return errorResponse(error, id);
      }

      if (!canUseGenericDecisions(authentication.clientId)) {
        const error = new ApiError("FORBIDDEN");
        logFailure(logger, {
          requestId: id,
          clientId: authentication.clientId,
          error,
          method: request.method,
          path: url.pathname,
          workerDurationMs: elapsedMs(started),
        });
        return errorResponse(error, id);
      }

      const config = resolveProviderConfig(env);
      if (!config.ok) {
        const error = new ApiError("NOT_CONFIGURED");
        logFailure(logger, {
          requestId: id,
          clientId: authentication.clientId,
          error,
          method: request.method,
          path: url.pathname,
          workerDurationMs: elapsedMs(started),
        });
        return errorResponse(error, id);
      }

      if (!hasJsonContentType(request)) {
        const error = new ApiError("INVALID_REQUEST", false, 415);
        logFailure(logger, {
          requestId: id,
          clientId: authentication.clientId,
          error,
          method: request.method,
          path: url.pathname,
          workerDurationMs: elapsedMs(started),
        });
        return errorResponse(error, id);
      }

      let requestBytes = 0;
      let questionCount: number | undefined;
      let providerAttempts = 0;
      const trackedFetch: typeof fetch = (input, init) => {
        providerAttempts += 1;
        return fetchImpl(input, init);
      };
      try {
        const input = await readBoundedRequest(request);
        requestBytes = input.size;
        const body = parseJson(input.bytes);
        const validated = validateDecisionRequest(body);
        if (!validated.ok) throw new ApiError(validated.code);
        questionCount = Object.keys(validated.value.questions).length;

        const providerStarted = performance.now();
        let result: Awaited<ReturnType<typeof requestOpenRouterDecision>>;
        try {
          result = await requestOpenRouterDecision(validated.value, config, trackedFetch);
        } catch (error) {
          if (error instanceof ProviderError) {
            const apiError = new ApiError(error.code, error.retryable);
            const providerDurationMs = elapsedMs(providerStarted);
            logFailure(logger, {
              requestId: id,
              clientId: authentication.clientId,
              error: apiError,
              method: request.method,
              path: url.pathname,
              requestBytes,
              questionCount,
              attemptCount: providerAttempts,
              workerDurationMs: elapsedMs(started),
              providerDurationMs,
              providerDiagnosticCode: error.diagnosticCode,
            });
            return errorResponse(apiError, id);
          }
          throw error;
        }

        const durationMs = elapsedMs(providerStarted);
        const response: DecisionResponse = {
          schemaVersion: "1",
          requestId: id,
          status: "completed",
          provider: "jev",
          model: result.model,
          answers: result.answers,
          ...(result.usage ? { usage: result.usage } : {}),
          durationMs,
          attemptCount: 1,
        };
        safeLog(logger, {
          event: "decision.completed",
          requestId: id,
          clientId: authentication.clientId,
          status: "completed",
          method: request.method,
          path: url.pathname,
          model: result.model,
          questionCount,
          requestBytes,
          providerDurationMs: durationMs,
          workerDurationMs: elapsedMs(started),
          attemptCount: providerAttempts,
          ...(result.usage ? { usage: result.usage } : {}),
        });
        return jsonResponse(response);
      } catch (error) {
        const apiError = error instanceof ApiError ? error : new ApiError("INTERNAL_ERROR");
        logFailure(logger, {
          requestId: id,
          clientId: authentication.clientId,
          error: apiError,
          method: request.method,
          path: url.pathname,
          requestBytes,
          questionCount,
          attemptCount: providerAttempts,
          workerDurationMs: elapsedMs(started),
        });
        return errorResponse(apiError, id);
      }
    },
  };
}

export default createWorker();
