import {
  type DecisionRequest,
  type DecisionResponse,
} from "../../contracts/decisions";
import { MIN_PROVIDER_TIMEOUT_MS, ProviderError, type ProviderConfig } from "./config";
import { classifyProviderFetchFailure, providerErrorFingerprint } from "./fetch-diagnostics";
import { readBoundedResponse, validateProviderPayload } from "./response";
import { parseRetryAfterSeconds } from "../../http/retry-after";

export async function requestOpenRouterDecision(
  request: DecisionRequest,
  config: Extract<ProviderConfig, { ok: true }>,
  fetchImpl: typeof fetch = fetch,
): Promise<Pick<DecisionResponse, "model" | "answers" | "usage"> & { attemptCount: number }> {
  const startedAt = performance.now();
  const providerDurationMs = () => Math.max(0, Math.round(performance.now() - startedAt));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  let upstreamStatus: number | undefined;
  let attemptCount = 0;
  try {
    let body: string;
    try {
      body = JSON.stringify({ model: config.model, state: request.state, questions: request.questions });
    } catch {
      throw new ProviderError("PROVIDER_UNAVAILABLE", false, { diagnosticCode: "provider_request_serialization_failed", attemptCount: 0 });
    }
    const init: RequestInit = {
      method: "POST",
      redirect: "manual",
      signal: controller.signal,
      headers: {
        authorization: config.authorizationHeader,
        "content-type": "application/json",
        accept: "application/json",
      },
      body,
    };
    try {
      new Request(config.requestUrl, init);
    } catch {
      throw new ProviderError("PROVIDER_UNAVAILABLE", false, { diagnosticCode: "provider_request_construction_failed", attemptCount: 0 });
    }
    while (attemptCount < 2) {
      attemptCount += 1;
      let response: Response;
      try {
        response = await fetchImpl(config.requestUrl, init);
      } catch (error) {
        const providerFetchFailureClass = classifyProviderFetchFailure(error, controller.signal.aborted);
        const fingerprint = providerErrorFingerprint(error);
        throw new ProviderError(
          controller.signal.aborted ? "PROVIDER_TIMEOUT" : "PROVIDER_UNAVAILABLE",
          true,
          {
            diagnosticCode: controller.signal.aborted ? undefined : "provider_fetch_failed",
            providerFetchFailureClass,
            providerErrorType: fingerprint.providerErrorType,
            providerCauseDepth: fingerprint.providerCauseDepth,
            providerCauseCode: fingerprint.providerCauseCode,
            attemptCount,
          },
        );
      }
      upstreamStatus = response.status;
      if (!response.ok) {
        const retryable = response.status === 408 || response.status === 425
          || response.status === 429 || response.status >= 500;
        const retryAfterSeconds = retryable ? parseRetryAfterSeconds(response.headers.get("retry-after")) : undefined;
        const retryBudgetMs = retryAfterSeconds === undefined ? 0 : retryAfterSeconds * 1_000;
        const mayRetryRateLimit = response.status === 429 && attemptCount === 1
          && retryAfterSeconds !== undefined && retryAfterSeconds <= 2
          && config.timeoutMs - providerDurationMs() > retryBudgetMs + MIN_PROVIDER_TIMEOUT_MS;
        await response.body?.cancel().catch(() => undefined);
        if (mayRetryRateLimit) {
          await waitForRetry(retryBudgetMs, controller.signal);
          continue;
        }
        throw new ProviderError(
          response.status === 429 ? "PROVIDER_RATE_LIMITED" : "PROVIDER_UNAVAILABLE",
          retryable,
          { diagnosticCode: "provider_http_error", upstreamStatus: response.status, retryAfterSeconds, attemptCount },
        );
      }
      const contentType = response.headers.get("content-type");
      if (contentType && !/^\s*application\/(?:[a-z0-9.+-]+\+)?json(?:\s*;|$)/i.test(contentType)) {
        throw new ProviderError("INVALID_PROVIDER_RESPONSE", false, { diagnosticCode: "response_content_type_unsupported", attemptCount });
      }
      try {
        const payload = await readBoundedResponse(response);
        return { ...validateProviderPayload(payload, request), attemptCount };
      } catch (error) {
        if (error instanceof ProviderError) {
          throw error.withDetails({ upstreamStatus: error.upstreamStatus ?? response.status, attemptCount });
        }
        throw error;
      }
    }
    throw new ProviderError("PROVIDER_UNAVAILABLE", true, { attemptCount });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new ProviderError("PROVIDER_TIMEOUT", true, {
        upstreamStatus,
        providerDurationMs: providerDurationMs(),
        providerFetchFailureClass: "timeout",
        attemptCount,
      });
    }
    if (error instanceof ProviderError) {
      throw error.withDetails({
        upstreamStatus: error.upstreamStatus ?? upstreamStatus,
        providerDurationMs: providerDurationMs(),
        attemptCount,
      });
    }
    const diagnosticCode = upstreamStatus === undefined ? "provider_unexpected_error" : "response_processing_failed";
    throw new ProviderError("PROVIDER_UNAVAILABLE", true, {
      diagnosticCode,
      upstreamStatus,
      providerDurationMs: providerDurationMs(),
      attemptCount,
    });
  } finally {
    clearTimeout(timeout);
  }
}

function waitForRetry(delayMs: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(new Error("retry_aborted"));
  if (delayMs === 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, delayMs);
    const onAbort = () => {
      clearTimeout(timer);
      cleanup();
      reject(new Error("retry_aborted"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
