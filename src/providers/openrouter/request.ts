import {
  type DecisionRequest,
  type DecisionResponse,
} from "../../contracts/decisions";
import { ProviderError, type ProviderConfig } from "./config";
import { readBoundedResponse, validateProviderPayload } from "./response";

const OPENROUTER_DECISIONS_URL = "https://openrouter.ai/api/alpha/decisions";

export async function requestOpenRouterDecision(
  request: DecisionRequest,
  config: Extract<ProviderConfig, { ok: true }>,
  fetchImpl: typeof fetch = fetch,
): Promise<Pick<DecisionResponse, "model" | "answers" | "usage">> {
  const startedAt = performance.now();
  const providerDurationMs = () => Math.max(0, Math.round(performance.now() - startedAt));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  let upstreamStatus: number | undefined;
  try {
    let response: Response;
    try {
      response = await fetchImpl(OPENROUTER_DECISIONS_URL, {
        method: "POST",
        redirect: "manual",
        signal: controller.signal,
        headers: {
          authorization: "Bearer " + config.apiKey,
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({
          model: config.model,
          state: request.state,
          questions: request.questions,
        }),
      });
    } catch {
      throw new ProviderError(
        controller.signal.aborted ? "PROVIDER_TIMEOUT" : "PROVIDER_UNAVAILABLE",
        true,
        controller.signal.aborted ? undefined : "provider_fetch_failed",
      );
    }
    upstreamStatus = response.status;
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      const retryable = response.status === 408 || response.status === 425
        || response.status === 429 || response.status >= 500;
      throw new ProviderError("PROVIDER_UNAVAILABLE", retryable, "provider_http_error", response.status);
    }
    const contentType = response.headers.get("content-type");
    if (contentType && !/^\s*application\/(?:[a-z0-9.+-]+\+)?json(?:\s*;|$)/i.test(contentType)) {
      throw new ProviderError("INVALID_PROVIDER_RESPONSE", false, "response_content_type_unsupported");
    }
    try {
      const payload = await readBoundedResponse(response);
      return validateProviderPayload(payload, request);
    } catch (error) {
      if (error instanceof ProviderError && error.upstreamStatus === undefined) {
        throw new ProviderError(error.code, error.retryable, error.diagnosticCode, response.status);
      }
      throw error;
    }
  } catch (error) {
    if (error instanceof ProviderError) {
      throw new ProviderError(
        error.code,
        error.retryable,
        error.diagnosticCode,
        error.upstreamStatus ?? upstreamStatus,
        providerDurationMs(),
      );
    }
    if (controller.signal.aborted) {
      throw new ProviderError("PROVIDER_TIMEOUT", true, undefined, upstreamStatus, providerDurationMs());
    }
    const diagnosticCode = upstreamStatus === undefined ? "provider_unexpected_error" : "response_processing_failed";
    throw new ProviderError("PROVIDER_UNAVAILABLE", true, diagnosticCode, upstreamStatus, providerDurationMs());
  } finally {
    clearTimeout(timeout);
  }
}
