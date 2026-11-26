type ScenarioBody = string | ((requestBody: unknown) => string | Promise<string>);
type ScenarioChunk = string | Uint8Array;

export type OpenRouterScenario =
  | { kind: "network-error"; message?: string; causeCode?: string }
  | {
    kind: "response";
    status?: number;
    headers?: HeadersInit;
    body?: ScenarioBody;
    headersDelayMs?: number;
    bodyChunks?: readonly ScenarioChunk[];
    chunkDelayMs?: number;
    failAfterChunks?: number;
  };

export interface SimulatedOpenRouterCall {
  url: string;
  method: string;
  body: unknown;
}

const OPENROUTER_URL = "https://openrouter.ai/api/alpha/decisions";

function abortError(signal: AbortSignal): unknown {
  return signal.reason ?? new Error("simulated_request_aborted");
}

function waitForDelay(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(abortError(signal));
  if (delayMs <= 0) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      if (signal) reject(abortError(signal));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function scenarioStream(
  chunks: readonly ScenarioChunk[],
  signal: AbortSignal | undefined,
  delayMs: number,
  failAfterChunks: number | undefined,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const bodyController = new AbortController();
  let cancelled = false;
  let index = 0;
  const cleanup = () => signal?.removeEventListener("abort", onRequestAbort);
  const onRequestAbort = () => bodyController.abort(signal?.reason);
  if (signal?.aborted) onRequestAbort();
  else signal?.addEventListener("abort", onRequestAbort, { once: true });

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (failAfterChunks !== undefined && index >= failAfterChunks) {
        cleanup();
        controller.error(new Error("simulated_response_stream_reset"));
        return;
      }
      if (index >= chunks.length) {
        cleanup();
        controller.close();
        return;
      }
      try {
        await waitForDelay(delayMs, bodyController.signal);
        const chunk = chunks[index++];
        controller.enqueue(typeof chunk === "string" ? encoder.encode(chunk) : chunk);
        if (index >= chunks.length && failAfterChunks === undefined) {
          cleanup();
          controller.close();
        }
      } catch (error) {
        cleanup();
        if (!cancelled) controller.error(error);
      }
    },
    cancel() {
      cancelled = true;
      bodyController.abort();
      cleanup();
    },
  });
}

/**
 * A deterministic, URL-restricted OpenRouter fetch simulator for provider and Worker tests.
 * Scenarios are consumed one per call; an unexpected extra request fails closed.
 */
export function createOpenRouterSimulator(initialScenarios: readonly OpenRouterScenario[] = []) {
  const scenarios = [...initialScenarios];
  const calls: SimulatedOpenRouterCall[] = [];

  const fetch: typeof globalThis.fetch = async (input, init) => {
    const request = input instanceof Request ? input.clone() : new Request(input, init);
    if (request.url !== OPENROUTER_URL) {
      throw new Error("simulator_blocked_unexpected_outbound_request");
    }

    const callIndex = calls.push({ url: request.url, method: request.method, body: undefined }) - 1;
    const scenario = scenarios.shift();
    if (!scenario) throw new Error("simulator_missing_scenario");

    let body: unknown;
    try {
      body = await request.clone().json();
    } catch {
      body = undefined;
    }
    calls[callIndex] = { url: request.url, method: request.method, body };
    if (scenario.kind === "network-error") {
      throw new Error(scenario.message ?? "simulated_network_failure", scenario.causeCode ? { cause: { code: scenario.causeCode } } : undefined);
    }

    const signal = init?.signal ?? request.signal;
    await waitForDelay(scenario.headersDelayMs ?? 0, signal);
    const headers = new Headers({ "content-type": "application/json", ...Object.fromEntries(new Headers(scenario.headers)) });
    const status = scenario.status ?? 200;
    if (scenario.bodyChunks || scenario.chunkDelayMs || scenario.failAfterChunks !== undefined) {
      const bodyChunks = scenario.bodyChunks ?? [await resolveBody(scenario.body, body)];
      return new Response(scenarioStream(bodyChunks, signal, scenario.chunkDelayMs ?? 0, scenario.failAfterChunks), {
        status,
        headers,
      });
    }

    return new Response(await resolveBody(scenario.body, body), { status, headers });
  };

  return {
    fetch,
    enqueue(...next: OpenRouterScenario[]) { scenarios.push(...next); },
    reset(...next: OpenRouterScenario[]) {
      scenarios.splice(0, scenarios.length, ...next);
      calls.length = 0;
    },
    get callCount() { return calls.length; },
    get pendingScenarioCount() { return scenarios.length; },
    get requests(): readonly SimulatedOpenRouterCall[] { return calls.map((call) => ({ ...call })); },
  };
}

async function resolveBody(body: ScenarioBody | undefined, requestBody: unknown): Promise<string> {
  if (typeof body === "function") return body(requestBody);
  return body ?? "";
}
