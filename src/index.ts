import { authenticateBearer } from "./auth/bearer";
import { ApiError, errorResponse } from "./api/errors";
import { isRequestObject, validateDecisionRequest } from "./contracts/validation";
import { LIMITS, type DecisionResponse, type Environment } from "./contracts/decisions";
import {
  DEFAULT_PROVIDER_TIMEOUT_MS,
  MAX_PROVIDER_TIMEOUT_MS,
  MIN_PROVIDER_TIMEOUT_MS,
  ProviderError,
  requestOpenRouterDecision,
  resolveProviderConfig,
} from "./providers/openrouter/decisions";
import { consoleLogger, safeLog, type Logger } from "./observability/log";

export interface WorkerDependencies {
  fetchImpl?: typeof fetch;
  logger?: Logger;
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
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
  const authConfigured = Boolean(env.SENKU_KASEKI_API_TOKEN?.trim())
    && new TextEncoder().encode(env.SENKU_KASEKI_API_TOKEN?.trim() ?? "").byteLength <= 1_024;
  return authConfigured && resolveProviderConfig(env).ok && timeoutIsStructurallyValid(env);
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
  },
): void {
  safeLog(logger, {
    event: "decision.request_failed",
    requestId: details.requestId,
    clientId: details.clientId ?? "unknown",
    status: details.error.code,
    errorCode: details.error.code,
    method: details.method,
    path: details.path,
    requestBytes: details.requestBytes,
    questionCount: details.questionCount,
    providerDurationMs: details.providerDurationMs,
    workerDurationMs: details.workerDurationMs,
    attemptCount: 0,
  });
}

export function createWorker(dependencies: WorkerDependencies = {}): {
  fetch(request: Request, env: Environment): Promise<Response>;
} {
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const logger = dependencies.logger ?? consoleLogger;

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

      const authentication = await authenticateBearer(request.headers.get("authorization"), env);
      if (!authentication.authenticated) {
        const error = new ApiError(authentication.reason === "not_configured" ? "NOT_CONFIGURED" : "UNAUTHENTICATED");
        logFailure(logger, {
          requestId: id,
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
          result = await requestOpenRouterDecision(validated.value, config, fetchImpl);
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
              workerDurationMs: elapsedMs(started),
              providerDurationMs,
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
          attemptCount: 1,
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
          workerDurationMs: elapsedMs(started),
        });
        return errorResponse(apiError, id);
      }
    },
  };
}

export default createWorker();
