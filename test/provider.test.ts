import { describe, expect, it, vi } from "vitest";
import { LIMITS, type DecisionRequest } from "../src/contracts/decisions";
import { DEFAULT_JEV_MODEL, ProviderError, requestOpenRouterDecision, resolveProviderConfig, type ProviderConfig } from "../src/providers/openrouter/decisions";
import { runOperationsTriageProfile } from "../src/profiles/soyuz/run-operations-triage";
import { kasekiRequest } from "./fixtures/kaseki-request";

// Contract basis: docs/PHASE-1-DECISIONS.md, provider response normalization and metadata policy.
const request = kasekiRequest as unknown as DecisionRequest;
const config: ProviderConfig & { ok: true } = {
  ok: true,
  apiKey: "test-openrouter-key",
  model: "~typesafe/jev-latest",
  timeoutMs: 1_000,
};

function providerBody(overrides: Record<string, unknown> = {}) {
  return {
    model: "typesafe/jev-1.14-20261014",
    answers: {
      failure_cause: {
        type: "choice",
        choice: "transient",
        probabilities: { transient: 0.94, code_defect: 0.04, unknown: 0.02 },
        confidence: 0.94,
      },
      safe_to_retry: { type: "noul", noul: 0.91 },
      completion_score: {
        type: "score",
        score: 1.9,
        legend: { "0": "not complete", "1": "partially complete", "2": "complete" },
        probabilities: { "0": 0.01, "1": 0.08, "2": 0.91 },
        confidence: 0.91,
      },
    },
    usage: { input_tokens: 420, output_tokens: 30, cost: 0.0001 },
    id: "provider-request-1",
    provider: "TypeSafe",
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function expectProviderError(
  promise: Promise<unknown>,
  code: ProviderError["code"],
  retryable: boolean,
  diagnosticCode?: ProviderError["diagnosticCode"],
) {
  try {
    await promise;
    throw new Error("Expected provider request to fail.");
  } catch (error) {
    expect(error).toBeInstanceOf(ProviderError);
    expect((error as ProviderError).code).toBe(code);
    expect((error as ProviderError).retryable).toBe(retryable);
    if (diagnosticCode) expect((error as ProviderError).diagnosticCode).toBe(diagnosticCode);
  }
}

describe("OpenRouter Decisions adapter", () => {
  it("sends one fixed-destination authenticated request and normalizes validated answers", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse(providerBody()));
    const result = await requestOpenRouterDecision(request, config, fetcher);
    const call = fetcher.mock.calls[0];
    expect(String(call[0])).toBe("https://openrouter.ai/api/alpha/decisions");
    expect(call[1]?.method).toBe("POST");
    expect(call[1]?.redirect).toBe("manual");
    expect(new Headers(call[1]?.headers).get("authorization")).toBe("Bearer test-openrouter-key");
    const sent = JSON.parse(String(call[1]?.body));
    expect(sent.model).toBe("~typesafe/jev-latest");
    expect(sent.state).toEqual(request.state);
    expect(sent.questions).toEqual(request.questions);

    expect(result.model).toBe("typesafe/jev-1.14-20261014");
    expect(result.answers.safe_to_retry).toMatchObject({
      type: "noul",
      noul: 0.91,
      probabilities: { true: 0.91 },
      confidence: null,
    });
    expect((result.answers.safe_to_retry as { probabilities: { false: number } }).probabilities.false).toBeCloseTo(0.09, 12);
    expect(result.answers.failure_cause).toMatchObject({ type: "choice", confidence: 0.94 });
    expect(result.answers.completion_score).toMatchObject({ type: "score", score: 1.9 });
    expect(result.usage).toEqual({ input_tokens: 420, output_tokens: 30, cost: 0.0001 });
  });

  it("allows missing optional confidence and usage without making up metadata", async () => {
    const body = providerBody();
    delete (body.answers.failure_cause as Record<string, unknown>).confidence;
    delete (body.answers.completion_score as Record<string, unknown>).confidence;
    delete (body as Record<string, unknown>).usage;
    const result = await requestOpenRouterDecision(request, config, async () => jsonResponse(body));
    expect(result.answers.failure_cause).toMatchObject({ confidence: null });
    expect(result.answers.completion_score).toMatchObject({ confidence: null });
    expect(result.usage).toBeUndefined();
  });

  it("normalizes explicit null confidence for choice and score answers", async () => {
    const body = providerBody();
    (body.answers.failure_cause as Record<string, unknown>).confidence = null;
    (body.answers.completion_score as Record<string, unknown>).confidence = null;
    const result = await requestOpenRouterDecision(request, config, async () => jsonResponse(body));
    expect(result.answers.failure_cause).toMatchObject({ confidence: null });
    expect(result.answers.completion_score).toMatchObject({ confidence: null });
  });

  it("rejects malformed confidence values for choice and score answers", async () => {
    for (const invalid of ["0.5", {}, -0.01, 1.01]) {
      const choice = providerBody();
      (choice.answers.failure_cause as Record<string, unknown>).confidence = invalid;
      await expectProviderError(requestOpenRouterDecision(request, config, async () => jsonResponse(choice)), "INVALID_PROVIDER_RESPONSE", false);

      const score = providerBody();
      (score.answers.completion_score as Record<string, unknown>).confidence = invalid;
      await expectProviderError(requestOpenRouterDecision(request, config, async () => jsonResponse(score)), "INVALID_PROVIDER_RESPONSE", false);
    }
  });

  it("keeps validated answers and recognized usage while dropping provider-only metadata", async () => {
    const body = providerBody({
      annotations: [{ url: "https://example.test/source", title: "Source", excerpt: "provider-only context" }],
      provider: { name: "TypeSafe", route: "new-provider-metadata" },
      future_response_field: { nested: [1, 2, 3] },
      usage: {
        input_tokens: 420,
        output_tokens: 30,
        cost: 0.0001,
        prompt_tokens: 419,
        cost_details: { upstream_inference_cost: 0.00008 },
      },
    });
    const result = await requestOpenRouterDecision(request, config, async () => jsonResponse(body));
    expect(result.model).toBe(body.model);
    expect(result.answers.safe_to_retry).toMatchObject({ type: "noul", noul: 0.91 });
    expect(result.usage).toEqual({ input_tokens: 420, output_tokens: 30, cost: 0.0001 });
    expect(result).not.toHaveProperty("annotations");
    expect(result).not.toHaveProperty("provider");
    expect(result).not.toHaveProperty("future_response_field");
  });

  it("omits malformed optional usage metadata without rejecting validated answers", async () => {
    const body = providerBody({ usage: { input_tokens: 420, output_tokens: "unknown", cost: -1 } });
    const result = await requestOpenRouterDecision(request, config, async () => jsonResponse(body));
    expect(result.answers.safe_to_retry).toMatchObject({ type: "noul", noul: 0.91 });
    expect(result.usage).toEqual({ input_tokens: 420 });
  });

  it("accepts the supplied Soyuz triage answer shape and keeps profile output validation", async () => {
    const triageRequest: DecisionRequest = { ...request, questions: runOperationsTriageProfile.questions };
    const body = {
      model: "typesafe/jev-1.14-20261014",
      answers: {
        needs_followup: { type: "noul", noul: 0.96 },
        likely_area: {
          type: "choice",
          choice: "execution",
          probabilities: { execution: 0.87, control_plane: 0.1, unknown: 0.03 },
          confidence: 0.8,
        },
        severity: {
          type: "score",
          score: 1.48,
          legend: { "0": "Routine", "1": "Needs review", "2": "Urgent" },
          probabilities: { "0": 0.01, "1": 0.51, "2": 0.48 },
          confidence: 0.26,
        },
      },
    };
    const result = await requestOpenRouterDecision(triageRequest, config, async () => jsonResponse(body));
    const triageInput = runOperationsTriageProfile.validateInput({ run: {
      status: "failed", stage: "validation", operationalHealth: "healthy", failureClass: null,
      createdAt: "2026-11-08T12:00:00.000Z", queuedAt: null, startedAt: null, completedAt: null, lastHeartbeatAt: null,
    } });
    expect(() => runOperationsTriageProfile.validateOutput(result.answers, triageInput)).not.toThrow();
    expect(result.answers.severity).toMatchObject({ type: "score", score: 1.48 });
  });

  it("normalizes stream-read failures without leaking provider details or making retries", async () => {
    const fetcher = vi.fn(async () => new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error("private upstream stream detail"));
      },
    }), { headers: { "content-type": "application/json" } }));
    await expectProviderError(requestOpenRouterDecision(request, config, fetcher), "PROVIDER_UNAVAILABLE", true, "response_body_read_failed");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("constrains configuration to the exact selected model alias", () => {
    expect(DEFAULT_JEV_MODEL).toBe("~typesafe/jev-latest");
    expect(resolveProviderConfig({ OPENROUTER_API_KEY: "test-key" })).toMatchObject({ ok: true, model: DEFAULT_JEV_MODEL });
    expect(resolveProviderConfig({ OPENROUTER_API_KEY: "test-key", JEV_MODEL: DEFAULT_JEV_MODEL })).toMatchObject({ ok: true, model: DEFAULT_JEV_MODEL });
    for (const JEV_MODEL of ["typesafe/jev-latest", "typesafe/jev-1.13", "~typesafe/jev-1.14", " ~typesafe/jev-latest"]) {
      expect(resolveProviderConfig({ OPENROUTER_API_KEY: "test-key", JEV_MODEL })).toEqual({ ok: false });
    }
  });

  it("reconstructs a missing score legend from the declared scale", async () => {
    const body = providerBody();
    delete (body.answers.completion_score as Record<string, unknown>).legend;
    const result = await requestOpenRouterDecision(request, config, async () => jsonResponse(body));
    expect(result.answers.completion_score).toMatchObject({
      legend: { "0": "not complete", "1": "partially complete", "2": "complete" },
    });
  });

  it("rejects non-2xx responses without returning the upstream body", async () => {
    for (const [status, retryable] of [[402, false], [429, true], [503, true]] as const) {
      await expectProviderError(
        requestOpenRouterDecision(request, config, async () => new Response("secret upstream diagnostic", { status })),
        "PROVIDER_UNAVAILABLE",
        retryable,
      );
    }
  });

  it("classifies network failures and timeouts as retryable without retrying", async () => {
    await expectProviderError(
      requestOpenRouterDecision(request, config, async () => { throw new Error("private network detail"); }),
      "PROVIDER_UNAVAILABLE",
      true,
    );

    const quickTimeoutConfig = { ...config, timeoutMs: 10 };
    const hangingFetcher: typeof fetch = (_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    });
    await expectProviderError(
      requestOpenRouterDecision(request, quickTimeoutConfig, hangingFetcher),
      "PROVIDER_TIMEOUT",
      true,
    );
  });

  it("rejects empty, malformed, non-JSON, or oversized provider responses", async () => {
    await expectProviderError(requestOpenRouterDecision(request, config, async () => new Response("")), "INVALID_PROVIDER_RESPONSE", false, "response_content_type_unsupported");
    await expectProviderError(requestOpenRouterDecision(request, config, async () => new Response("{", {
      headers: { "content-type": "application/json" },
    })), "INVALID_PROVIDER_RESPONSE", false, "response_body_invalid_json");
    await expectProviderError(requestOpenRouterDecision(request, config, async () => new Response("{}", {
      headers: { "content-type": "text/plain" },
    })), "INVALID_PROVIDER_RESPONSE", false, "response_content_type_unsupported");

    const largeResponse = new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(LIMITS.providerResponseBytes + 1));
        controller.close();
      },
    }));
    await expectProviderError(requestOpenRouterDecision(request, config, async () => largeResponse), "INVALID_PROVIDER_RESPONSE", false, "response_body_too_large");
  });

  it("rejects missing and unexpected answer keys, types, and nested fields", async () => {
    const missing = providerBody();
    delete (missing.answers as Record<string, unknown>).safe_to_retry;
    await expectProviderError(requestOpenRouterDecision(request, config, async () => jsonResponse(missing)), "INVALID_PROVIDER_RESPONSE", false, "response_answer_set_mismatch");

    const extra = providerBody();
    (extra.answers as Record<string, unknown>).unexpected = { type: "noul", noul: 0.5 };
    await expectProviderError(requestOpenRouterDecision(request, config, async () => jsonResponse(extra)), "INVALID_PROVIDER_RESPONSE", false);

    const wrongType = providerBody();
    (wrongType.answers as Record<string, Record<string, unknown>>).safe_to_retry.type = "choice";
    await expectProviderError(requestOpenRouterDecision(request, config, async () => jsonResponse(wrongType)), "INVALID_PROVIDER_RESPONSE", false);

    const extraField = providerBody();
    (extraField.answers.safe_to_retry as Record<string, unknown>).debug = "not allowed";
    await expectProviderError(requestOpenRouterDecision(request, config, async () => jsonResponse(extraField)), "INVALID_PROVIDER_RESPONSE", false);
  });

  it("rejects invalid NouL probabilities and choice selections/distributions", async () => {
    const badNoul = providerBody();
    (badNoul.answers.safe_to_retry as Record<string, unknown>).noul = 1.1;
    await expectProviderError(requestOpenRouterDecision(request, config, async () => jsonResponse(badNoul)), "INVALID_PROVIDER_RESPONSE", false);

    const badLabel = providerBody();
    (badLabel.answers.failure_cause as Record<string, unknown>).choice = "execute";
    await expectProviderError(requestOpenRouterDecision(request, config, async () => jsonResponse(badLabel)), "INVALID_PROVIDER_RESPONSE", false);

    const badDistribution = providerBody();
    (badDistribution.answers.failure_cause as Record<string, unknown>).probabilities = {
      transient: 0.8,
      code_defect: 0.1,
      unknown: 0.1,
      extra: 0,
    };
    await expectProviderError(requestOpenRouterDecision(request, config, async () => jsonResponse(badDistribution)), "INVALID_PROVIDER_RESPONSE", false);

    const badSum = providerBody();
    (badSum.answers.failure_cause as Record<string, unknown>).probabilities = {
      transient: 0.8,
      code_defect: 0.1,
      unknown: 0.05,
    };
    await expectProviderError(requestOpenRouterDecision(request, config, async () => jsonResponse(badSum)), "INVALID_PROVIDER_RESPONSE", false);
  });

  it("rejects score values, probability keys, or legends outside the declared scale", async () => {
    const badScore = providerBody();
    (badScore.answers.completion_score as Record<string, unknown>).score = 3;
    await expectProviderError(requestOpenRouterDecision(request, config, async () => jsonResponse(badScore)), "INVALID_PROVIDER_RESPONSE", false);

    const badKeys = providerBody();
    (badKeys.answers.completion_score as Record<string, unknown>).probabilities = { "0": 0.5, "2": 0.5 };
    await expectProviderError(requestOpenRouterDecision(request, config, async () => jsonResponse(badKeys)), "INVALID_PROVIDER_RESPONSE", false);

    const badLegend = providerBody();
    (badLegend.answers.completion_score as Record<string, unknown>).legend = {
      "0": "not complete",
      "1": "wrong legend",
      "2": "complete",
    };
    await expectProviderError(requestOpenRouterDecision(request, config, async () => jsonResponse(badLegend)), "INVALID_PROVIDER_RESPONSE", false);
  });
});
