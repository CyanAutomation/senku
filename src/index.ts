import { areMachineTokenCredentialsDistinct, authenticateBearer, type AuthenticationResult } from "./auth/bearer";
import { canEvaluateProfile, type ClientIdentity } from "./auth/permissions";
import { ApiError, errorResponse } from "./api/errors";
import { serializeOpenApiDocument } from "./api/openapi";
import { getPublicProfileContract, listPublicProfiles } from "./api/profile-contracts";
import { serializeUtcpManual, trustedSenkuOrigin } from "./api/utcp";
import { LIMITS, type Environment } from "./contracts/decisions";
import { ProfileEngineError } from "./contracts/profiles";
import { isPlainRecord } from "./contracts/records";
import { evaluateProfile } from "./decisions/profile-engine";
import { profileRegistry, type RegisteredProfileId } from "./decisions/profile-registry";
import {
  DEFAULT_PROVIDER_TIMEOUT_MS,
  MAX_PROVIDER_TIMEOUT_MS,
  MIN_PROVIDER_TIMEOUT_MS,
  ProviderError,
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
  if (!isPlainRecord(value)) throw new ApiError("INVALID_REQUEST");
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

type ProtectedRoute =
  | { kind: "profile-list"; expectedMethod: "GET"; logPath: "/v1/profiles" }
  | { kind: "profile-detail"; expectedMethod: "GET"; logPath: "/v1/profiles/{profileId}"; profileId: string }
  | { kind: "profile-evaluation"; expectedMethod: "POST"; logPath: "/v1/profiles/{profileId}/evaluate"; profileId: string }
  | { kind: "openapi"; expectedMethod: "GET"; logPath: "/openapi.json" }
  | { kind: "utcp"; expectedMethod: "GET"; logPath: "/utcp" };

interface WorkerRuntime {
  fetchImpl: typeof fetch;
  logger: Logger;
  serializeManual: typeof serializeUtcpManual;
  resolveIdentity: (request: Request, env: Environment) => Promise<AuthenticationResult>;
}

interface RequestContext extends WorkerRuntime {
  request: Request;
  env: Environment;
  id: string;
  started: number;
}

function methodNotAllowed(id: string, expectedMethod: string): Response {
  const response = errorResponse(new ApiError("INVALID_REQUEST", false, 405), id);
  response.headers.set("allow", expectedMethod);
  return response;
}

function healthRouteResponse(path: string, request: Request, env: Environment, id: string): Response | null {
  if (path !== "/healthz" && path !== "/readyz") return null;
  if (request.method !== "GET") return methodNotAllowed(id, "GET");
  if (path === "/healthz") return jsonResponse({ status: "ok" });
  const isReady = ready(env);
  return jsonResponse({ status: isReady ? "ready" : "not_ready" }, isReady ? 200 : 503);
}

function matchProtectedRoute(path: string): ProtectedRoute | null {
  if (path === "/v1/profiles") return { kind: "profile-list", expectedMethod: "GET", logPath: "/v1/profiles" };
  if (path === "/openapi.json") return { kind: "openapi", expectedMethod: "GET", logPath: "/openapi.json" };
  if (path === "/utcp") return { kind: "utcp", expectedMethod: "GET", logPath: "/utcp" };

  const evaluationMatch = /^\/v1\/profiles\/([^/]+)\/evaluate$/.exec(path);
  if (evaluationMatch) {
    return {
      kind: "profile-evaluation",
      expectedMethod: "POST",
      logPath: "/v1/profiles/{profileId}/evaluate",
      profileId: evaluationMatch[1],
    };
  }
  const detailMatch = /^\/v1\/profiles\/([^/]+)$/.exec(path);
  if (detailMatch) {
    return {
      kind: "profile-detail",
      expectedMethod: "GET",
      logPath: "/v1/profiles/{profileId}",
      profileId: detailMatch[1],
    };
  }
  return null;
}

function logProfileRequestFailure(
  context: RequestContext,
  clientId: ClientIdentity,
  error: ApiError,
  path: string,
): Response {
  logFailure(context.logger, {
    requestId: context.id,
    clientId,
    error,
    method: context.request.method,
    path,
    workerDurationMs: elapsedMs(context.started),
    event: "profile.request_failed",
  });
  return errorResponse(error, context.id);
}

function profileEvaluationFailure(
  context: RequestContext,
  clientId: ClientIdentity,
  error: ApiError,
  details: { profileId: string; path: string; requestBytes?: number; questionCount?: number; attemptCount?: number; cause?: unknown },
): Response {
  logFailure(context.logger, {
    requestId: context.id,
    clientId,
    error,
    method: context.request.method,
    path: details.path,
    requestBytes: details.requestBytes,
    questionCount: details.questionCount,
    attemptCount: details.attemptCount,
    profileId: details.profileId,
    workerDurationMs: elapsedMs(context.started),
    event: "profile.evaluation_failed",
    providerDiagnosticCode: profileProviderDiagnosticCode(details.cause),
  });
  return errorResponse(error, context.id);
}

async function evaluateProfileRequest(
  context: RequestContext,
  clientId: ClientIdentity,
  route: Extract<ProtectedRoute, { kind: "profile-evaluation" }>,
  profileId: string,
  profile: ReturnType<typeof profileRegistry.getProfile>,
): Promise<Response> {
  if (!hasJsonContentType(context.request)) {
    return profileEvaluationFailure(context, clientId, new ApiError("INVALID_REQUEST", false, 415), {
      profileId, path: route.logPath,
    });
  }

  let requestBytes = 0;
  let providerAttempts = 0;
  const questionCount = profile.maxQuestionCount ?? Object.keys(profile.questions).length;
  const trackedFetch: typeof fetch = (input, init) => {
    providerAttempts += 1;
    return context.fetchImpl(input, init);
  };
  try {
    const input = await readBoundedRequest(context.request);
    requestBytes = input.size;
    const profileInput = profileInputFromEnvelope(parseJson(input.bytes));
    const result = await evaluateProfile(route.profileId as RegisteredProfileId, profileInput, {
      clientIdentity: clientId,
    }, { env: context.env, fetchImpl: trackedFetch });
    const response = {
      schemaVersion: "1",
      requestId: context.id,
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
    safeLog(context.logger, {
      event: "profile.evaluation_completed",
      requestId: context.id,
      clientId,
      profileId: result.profileId,
      profileVersion: result.profileVersion,
      status: "completed",
      method: context.request.method,
      path: route.logPath,
      model: result.model,
      questionCount: result.metadata.questionCount,
      evidenceBytes: result.metadata.evidenceBytes,
      requestBytes,
      providerDurationMs: result.metadata.providerDurationMs,
      workerDurationMs: elapsedMs(context.started),
      attemptCount: result.metadata.attemptCount,
      ...(result.metadata.usage ? { usage: result.metadata.usage } : {}),
    });
    return jsonResponse(response);
  } catch (error) {
    return profileEvaluationFailure(context, clientId, profileApiError(error), {
      profileId,
      path: route.logPath,
      requestBytes,
      questionCount,
      attemptCount: providerAttempts,
      cause: error,
    });
  }
}

async function handleProfileResource(
  context: RequestContext,
  clientId: ClientIdentity,
  route: Extract<ProtectedRoute, { kind: "profile-detail" | "profile-evaluation" }>,
): Promise<Response> {
  const profileId = profileIdFromPath(route.profileId);
  if (!profileId) return logProfileRequestFailure(context, clientId, new ApiError("INVALID_REQUEST"), route.logPath);
  if (!canEvaluateProfile(profileId, clientId)) {
    return logProfileRequestFailure(context, clientId, new ApiError("FORBIDDEN"), route.logPath);
  }

  let profile: ReturnType<typeof profileRegistry.getProfile>;
  try {
    profile = profileRegistry.getProfile(profileId);
  } catch (error) {
    return logProfileRequestFailure(context, clientId, profileApiError(error), route.logPath);
  }

  if (route.kind === "profile-detail") return jsonResponse(getPublicProfileContract(profileId));
  return evaluateProfileRequest(context, clientId, route, profileId, profile);
}

async function handleProtectedRoute(context: RequestContext, route: ProtectedRoute): Promise<Response> {
  if (context.request.method !== route.expectedMethod) return methodNotAllowed(context.id, route.expectedMethod);
  const authentication = await context.resolveIdentity(context.request, context.env);
  if (!authentication.authenticated) {
    const error = authError(authentication);
    logFailure(context.logger, {
      requestId: context.id,
      error,
      method: context.request.method,
      path: route.logPath,
      workerDurationMs: elapsedMs(context.started),
      event: "profile.request_failed",
    });
    return errorResponse(error, context.id);
  }

  if (route.kind === "profile-list") {
    return jsonResponse({ schemaVersion: "1", profiles: listPublicProfiles(authentication.clientId) });
  }
  if (route.kind === "openapi") {
    try {
      return serializedJsonResponse(serializeOpenApiDocument(authentication.clientId));
    } catch {
      return internalRouteFailure(context.logger, {
        requestId: context.id,
        clientId: authentication.clientId,
        request: context.request,
        path: route.logPath,
        started: context.started,
      });
    }
  }
  if (route.kind === "utcp") {
    try {
      const manual = context.serializeManual(authentication.clientId, context.env.SENKU_PUBLIC_BASE_URL);
      return manual ? serializedJsonResponse(manual) : errorResponse(new ApiError("NOT_CONFIGURED"), context.id);
    } catch {
      return internalRouteFailure(context.logger, {
        requestId: context.id,
        clientId: authentication.clientId,
        request: context.request,
        path: route.logPath,
        started: context.started,
      });
    }
  }
  return handleProfileResource(context, authentication.clientId, route);
}

export function createWorker(dependencies: WorkerDependencies = {}): {
  fetch(request: Request, env: Environment): Promise<Response>;
} {
  const runtime: WorkerRuntime = {
    fetchImpl: dependencies.fetchImpl ?? fetch,
    logger: dependencies.logger ?? consoleLogger,
    serializeManual: dependencies.serializeUtcpManual ?? serializeUtcpManual,
    resolveIdentity: dependencies.resolveIdentity
      ?? ((request, env) => authenticateBearer(request.headers.get("authorization"), env)),
  };

  return {
    async fetch(request: Request, env: Environment): Promise<Response> {
      const started = performance.now();
      const id = requestId();
      const context: RequestContext = { ...runtime, request, env, id, started };
      const path = new URL(request.url).pathname;
      const healthResponse = healthRouteResponse(path, request, env, id);
      if (healthResponse) return healthResponse;

      const route = matchProtectedRoute(path);
      if (route) return handleProtectedRoute(context, route);
      return errorResponse(new ApiError("NOT_FOUND"), id);
    },
  };
}

export default createWorker();
