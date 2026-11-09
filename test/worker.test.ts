import { describe, expect, it, vi } from "vitest";
import { createWorker } from "../src/index";
import { LIMITS, type DecisionRequest, type Environment } from "../src/contracts/decisions";
import { kasekiRequest } from "./fixtures/kaseki-request";
import { soyuzRequest } from "./fixtures/soyuz-request";

const env: Environment = {
  OPENROUTER_API_KEY: "test-openrouter-key",
  SENKU_KASEKI_API_TOKEN: "test-client-token-0123456789abcdef",
  SENKU_SOYUZ_API_TOKEN: "test-soyuz-token-0123456789abcdef",
  JEV_MODEL: "~typesafe/jev-latest",
  SENKU_PROVIDER_TIMEOUT_MS: "15000",
};

function providerResponse(request: DecisionRequest): Response {
  const answers: Record<string, unknown> = {};
  for (const [id, question] of Object.entries(request.questions)) {
    if (question.type === "noul") {
      answers[id] = { type: "noul", noul: 0.75 };
    } else if (question.type === "choice") {
      const keys = Object.keys(question.criteria);
      answers[id] = {
        type: "choice",
        choice: keys[0],
        probabilities: Object.fromEntries(keys.map((key, index) => [key, index === 0 ? 1 : 0])),
        confidence: 1,
      };
    } else {
      const keys = question.criteria.map((_level, index) => String(index));
      answers[id] = {
        type: "score",
        score: 0,
        legend: Object.fromEntries(question.criteria.map((level, index) => [
          String(index),
          typeof level === "string" ? level : JSON.stringify(level),
        ])),
        probabilities: Object.fromEntries(keys.map((key, index) => [key, index === 0 ? 1 : 0])),
        confidence: 1,
      };
    }
  }
  return new Response(JSON.stringify({
    model: "typesafe/jev-1.14-20261014",
    answers,
    usage: { input_tokens: 18, output_tokens: 7 },
  }), { headers: { "content-type": "application/json" } });
}

function request(
  body: string,
  options: { method?: string; contentType?: string; authorization?: string } = {},
): Request {
  const headers = new Headers();
  if (options.authorization !== undefined) headers.set("authorization", options.authorization);
  if (options.contentType !== undefined) headers.set("content-type", options.contentType);
  return new Request("https://senku.test/v1/decisions", {
    method: options.method ?? "POST",
    headers,
    body: options.method === "GET" || options.method === "HEAD" ? undefined : body,
  });
}

function createTestWorker(fetchImpl: typeof fetch, logs: Array<Record<string, unknown>> = []) {
  return createWorker({ fetchImpl, logger: (record) => logs.push(record as Record<string, unknown>) });
}

describe("Worker routes and decision orchestration", () => {
  it("completes an authenticated decision request with the versioned envelope", async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      return providerResponse(JSON.parse(String(init?.body)) as DecisionRequest);
    });
    const response = await createTestWorker(fetchImpl).fetch(
      request(JSON.stringify(kasekiRequest), { authorization: "Bearer test-client-token-0123456789abcdef", contentType: "application/json" }),
      env,
    );
    const body = await response.json() as Record<string, unknown>;
    expect(response.status).toBe(200);
    expect(body.schemaVersion).toBe("1");
    expect(body.status).toBe("completed");
    expect(body.provider).toBe("jev");
    expect(body.model).toBe("typesafe/jev-1.14-20261014");
    expect(body.attemptCount).toBe(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("accepts both sanitized Kaseki and Soyuz input fixtures without changing their meaning", async () => {
    for (const fixture of [kasekiRequest, soyuzRequest]) {
      const response = await createTestWorker(async (_input, init) => providerResponse(JSON.parse(String(init?.body)) as DecisionRequest))
        .fetch(request(JSON.stringify(fixture), { authorization: "Bearer test-client-token-0123456789abcdef", contentType: "application/json" }), env);
      expect(response.status).toBe(200);
    }
  });

  it("rejects missing, malformed, and incorrect bearer tokens before calling the provider", async () => {
    const fetchImpl = vi.fn(async () => providerResponse(kasekiRequest as unknown as DecisionRequest));
    const worker = createTestWorker(fetchImpl);
    for (const authorization of [undefined, "Basic abc", "Bearer", "Bearer wrong-token-0123456789abcdef"]) {
      const response = await worker.fetch(request(JSON.stringify(kasekiRequest), {
        authorization,
        contentType: "application/json",
      }), env);
      expect(response.status).toBe(401);
      expect((await response.json() as { error: { code: string } }).error.code).toBe("UNAUTHENTICATED");
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("fails closed when the authentication secret is missing", async () => {
    const fetchImpl = vi.fn(async () => providerResponse(kasekiRequest as unknown as DecisionRequest));
    const response = await createTestWorker(fetchImpl).fetch(
      request(JSON.stringify(kasekiRequest), { authorization: "Bearer test-client-token-0123456789abcdef", contentType: "application/json" }),
      { ...env, SENKU_KASEKI_API_TOKEN: undefined },
    );
    expect(response.status).toBe(503);
    expect((await response.json() as { error: { code: string } }).error.code).toBe("NOT_CONFIGURED");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reports not ready for malformed machine-token configuration", async () => {
    const fetchImpl = vi.fn(async () => providerResponse(kasekiRequest as unknown as DecisionRequest));
    const worker = createTestWorker(fetchImpl);
    for (const token of ["", "too-short", "test-client-token-0123456789abcdef ", "x".repeat(1_025)]) {
      const response = await worker.fetch(
        new Request("https://senku.test/readyz"),
        { ...env, SENKU_KASEKI_API_TOKEN: token },
      );
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ status: "not_ready" });
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns a safe not-configured error when provider credentials are absent", async () => {
    const response = await createTestWorker(async () => providerResponse(kasekiRequest as unknown as DecisionRequest)).fetch(
      request(JSON.stringify(kasekiRequest), { authorization: "Bearer test-client-token-0123456789abcdef", contentType: "application/json" }),
      { ...env, OPENROUTER_API_KEY: undefined },
    );
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("test-client-token");
  });

  it("rejects unsupported content types, invalid JSON, invalid schemas, and unsupported versions", async () => {
    const fetchImpl = vi.fn(async () => providerResponse(kasekiRequest as unknown as DecisionRequest));
    const worker = createTestWorker(fetchImpl);
    const validAuth = { authorization: "Bearer test-client-token-0123456789abcdef" };

    expect((await worker.fetch(request("{}", { ...validAuth, contentType: "text/plain" }), env)).status).toBe(415);
    expect((await worker.fetch(request("{", { ...validAuth, contentType: "application/json" }), env)).status).toBe(400);
    expect((await worker.fetch(request('{"schemaVersion":"1","state":"x","questions":{}}', {
      ...validAuth,
      contentType: "application/json",
    }), env)).status).toBe(400);
    const unsupported = JSON.stringify({ ...soyuzRequest, schemaVersion: "2" });
    const versionResponse = await worker.fetch(request(unsupported, { ...validAuth, contentType: "application/json" }), env);
    expect(versionResponse.status).toBe(400);
    expect((await versionResponse.json() as { error: { code: string } }).error.code).toBe("UNSUPPORTED_SCHEMA_VERSION");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("enforces the actual streamed request-byte boundary", async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => providerResponse(JSON.parse(String(init?.body)) as DecisionRequest));
    const worker = createTestWorker(fetchImpl);
    const base = { schemaVersion: "1", state: "", questions: { q: { type: "noul", instructions: "Is this likely?" } } };
    const baseBytes = new TextEncoder().encode(JSON.stringify(base)).byteLength;
    const exactBody = JSON.stringify({
      ...base,
      state: "x".repeat(LIMITS.requestBytes - baseBytes),
    });
    expect(new TextEncoder().encode(exactBody).byteLength).toBe(LIMITS.requestBytes);

    const accepted = await worker.fetch(request(exactBody, {
      authorization: "Bearer test-client-token-0123456789abcdef",
      contentType: "application/json",
    }), env);
    expect(accepted.status).toBe(200);

    const oversizedBody = JSON.stringify({
      ...base,
      state: "x".repeat(LIMITS.requestBytes - baseBytes + 1),
    });
    expect(new TextEncoder().encode(oversizedBody).byteLength).toBe(LIMITS.requestBytes + 1);
    const rejected = await worker.fetch(request(oversizedBody, {
      authorization: "Bearer test-client-token-0123456789abcdef",
      contentType: "application/json",
    }), env);
    expect(rejected.status).toBe(413);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("returns stable liveness and readiness responses without provider calls or secret disclosure", async () => {
    const fetchImpl = vi.fn(async () => providerResponse(kasekiRequest as unknown as DecisionRequest));
    const worker = createTestWorker(fetchImpl);
    const health = await worker.fetch(new Request("https://senku.test/healthz"), {});
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ status: "ok" });

    const ready = await worker.fetch(new Request("https://senku.test/readyz"), env);
    expect(ready.status).toBe(200);
    const readyBody = await ready.json();
    expect(readyBody).toEqual({ status: "ready" });
    expect(JSON.stringify(readyBody)).not.toContain("test-openrouter-key");

    const notReady = await worker.fetch(new Request("https://senku.test/readyz"), {
      ...env,
      SENKU_PROVIDER_TIMEOUT_MS: "30001",
    });
    expect(notReady.status).toBe(503);
    expect(await notReady.json()).toEqual({ status: "not_ready" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns 404 for unknown profile routes and 405 for unsupported methods", async () => {
    const worker = createTestWorker(async () => providerResponse(kasekiRequest as unknown as DecisionRequest));
    const missing = await worker.fetch(new Request("https://senku.test/v1/profiles/no_such_profile", {
      headers: { authorization: "Bearer test-client-token-0123456789abcdef" },
    }), env);
    expect(missing.status).toBe(404);
    expect((await missing.json() as { error: { code: string } }).error.code).toBe("NOT_FOUND");

    const wrongMethod = await worker.fetch(new Request("https://senku.test/v1/decisions"), env);
    expect(wrongMethod.status).toBe(405);
    expect(wrongMethod.headers.get("allow")).toBe("POST");

    const wrongHealthMethod = await worker.fetch(new Request("https://senku.test/healthz", { method: "POST" }), env);
    expect(wrongHealthMethod.status).toBe(405);
    expect(wrongHealthMethod.headers.get("allow")).toBe("GET");
  });

  it("maps provider failures to typed, safe errors and performs exactly one attempt", async () => {
    const secretDetail = "private provider response body";
    const fetchImpl = vi.fn(async () => new Response(secretDetail, { status: 503 }));
    const logs: Array<Record<string, unknown>> = [];
    const response = await createTestWorker(fetchImpl, logs).fetch(
      request(JSON.stringify(kasekiRequest), { authorization: "Bearer test-client-token-0123456789abcdef", contentType: "application/json" }),
      env,
    );
    expect(response.status).toBe(502);
    const body = await response.json() as { error: { code: string; retryable: boolean; requestId: string; message: string } };
    expect(body.error).toMatchObject({ code: "PROVIDER_UNAVAILABLE", retryable: true });
    expect(body.error.requestId).toMatch(/^dec-/);
    expect(JSON.stringify(body)).not.toContain(secretDetail);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(logs).toHaveLength(1);
  });

  it("logs only safe metadata and never includes inputs, answers, or credentials", async () => {
    const stateMarker = "unique-private-run-evidence";
    const body = {
      schemaVersion: "1",
      state: stateMarker,
      questions: { q: { type: "noul", instructions: "Contains no real sensitive content." } },
    };
    const logs: Array<Record<string, unknown>> = [];
    const response = await createTestWorker(async (_input, init) => {
      const sent = JSON.parse(String(init?.body)) as DecisionRequest;
      return providerResponse(sent);
    }, logs).fetch(
      request(JSON.stringify(body), { authorization: "Bearer test-client-token-0123456789abcdef", contentType: "application/json" }),
      env,
    );
    expect(response.status).toBe(200);
    const serializedLog = JSON.stringify(logs);
    expect(serializedLog).toContain("clientId");
    expect(serializedLog).not.toContain(stateMarker);
    expect(serializedLog).not.toContain("test-client-token-0123456789abcdef");
    expect(serializedLog).not.toContain("test-openrouter-key");
    expect(serializedLog).not.toContain('"noul":0.75');
  });
});
