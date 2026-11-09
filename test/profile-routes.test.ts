import { describe, expect, it, vi } from "vitest";
import { createWorker } from "../src/index";
import type { DecisionRequest, Environment } from "../src/contracts/decisions";

const KASEKI_TOKEN = "profile-route-kaseki-token-0123456789abcdef";
const SOYUZ_TOKEN = "profile-route-soyuz-token-0123456789abcdef";
const env: Environment = {
  OPENROUTER_API_KEY: "test-openrouter-key",
  SENKU_KASEKI_API_TOKEN: KASEKI_TOKEN,
  SENKU_SOYUZ_API_TOKEN: SOYUZ_TOKEN,
  JEV_MODEL: "~typesafe/jev-latest",
  SENKU_PROVIDER_TIMEOUT_MS: "15000",
};

function providerResponse(request: DecisionRequest, options: { usage?: boolean; invalid?: boolean } = {}): Response {
  const answers = options.invalid ? {} : Object.fromEntries(Object.entries(request.questions).map(([id, question]) => {
    if (question.type === "noul") return [id, { type: "noul", noul: 0.91 }];
    if (question.type === "choice") {
      const keys = Object.keys(question.criteria);
      return [id, {
        type: "choice",
        choice: keys[0],
        probabilities: Object.fromEntries(keys.map((key, index) => [key, index === 0 ? 1 : 0])),
        confidence: null,
      }];
    }
    const keys = question.criteria.map((_criterion, index) => String(index));
    return [id, {
      type: "score",
      score: 1,
      legend: Object.fromEntries(question.criteria.map((criterion, index) => [String(index), String(criterion)])),
      probabilities: Object.fromEntries(keys.map((key, index) => [key, index === 1 ? 1 : 0])),
      confidence: null,
    }];
  }));
  return new Response(JSON.stringify({
    model: "typesafe/jev-1.14-20261014",
    answers,
    ...(options.usage ? { usage: { input_tokens: 120 } } : {}),
  }), { headers: { "content-type": "application/json" } });
}

function request(path: string, options: {
  method?: string;
  token?: string;
  body?: unknown;
  contentType?: string;
  clientIdentityHeader?: string;
} = {}): Request {
  const headers = new Headers();
  if (options.token) headers.set("authorization", `Bearer ${options.token}`);
  if (options.contentType !== undefined) headers.set("content-type", options.contentType);
  if (options.clientIdentityHeader) headers.set("x-senku-client", options.clientIdentityHeader);
  return new Request(`https://senku.test${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined || options.method === "GET" ? undefined : JSON.stringify(options.body),
  });
}

const scenarios = [
  { id: "run_operations_triage_v1", token: SOYUZ_TOKEN, input: { run: {
    status: "failed", stage: "validation", operationalHealth: "suspect_stalled", failureClass: "provider_failure",
    createdAt: "2026-11-08T12:00:00.000Z", queuedAt: "2026-11-08T12:00:01.000Z", startedAt: "2026-11-08T12:00:02.000Z",
    completedAt: "2026-11-08T12:00:03.000Z", lastHeartbeatAt: "2026-11-08T12:00:02.500Z",
  } } },
  { id: "kaseki_output_review_v1", token: SOYUZ_TOKEN, input: { canonicalRun: { status: "completed", failureClass: null, exitCode: 0, changedFileCount: 3 }, summary: "Implemented and validated." } },
  { id: "kaseki_output_review_v2", token: SOYUZ_TOKEN, input: { canonicalRun: { status: "completed", failureClass: null, exitCode: 0, changedFileCount: 3 }, summary: "Implemented and validated." } },
  { id: "task_admission_v1", token: KASEKI_TOKEN, input: { repoUrl: "https://github.com/CyanAutomation/senku", taskPrompt: "Add the authenticated profile REST API." } },
  { id: "validation_recovery_v1", token: KASEKI_TOKEN, input: { command: "npm test", exitCode: 1, output: "Assertion failed." } },
] as const;

describe("authenticated profile REST routes", () => {
  it("evaluates each registered profile through the HTTP envelope with one provider attempt", async () => {
    for (const scenario of scenarios) {
      const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
        providerResponse(JSON.parse(String(init?.body)) as DecisionRequest, { usage: true }));
      const response = await createWorker({ fetchImpl, logger: () => undefined }).fetch(
        request(`/v1/profiles/${scenario.id}/evaluate`, {
          method: "POST", token: scenario.token, body: { schemaVersion: "1", input: scenario.input }, contentType: "application/json",
        }),
        env,
      );
      const body = await response.json() as Record<string, unknown>;
      expect(response.status).toBe(200);
      expect(body).toMatchObject({
        schemaVersion: "1", status: "completed", profileId: scenario.id,
        profileVersion: scenario.id === "kaseki_output_review_v2" ? "2" : "1",
        provider: "jev", model: "typesafe/jev-1.14-20261014", attemptCount: 1,
        usage: { input_tokens: 120 },
      });
      expect(body.requestId).toMatch(/^dec-/);
      expect(body.durationMs).toEqual(expect.any(Number));
      expect(body.answers).toEqual(body.result);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    }
  });

  it("authenticates discovery and hides profiles outside the caller's permissions", async () => {
    const worker = createWorker({ fetchImpl: vi.fn(async () => providerResponse({} as DecisionRequest)), logger: () => undefined });
    const unauthenticated = await worker.fetch(request("/v1/profiles"), env);
    expect(unauthenticated.status).toBe(401);

    const kaseki = await worker.fetch(request("/v1/profiles", { token: KASEKI_TOKEN }), env);
    const kasekiBody = await kaseki.json() as { profiles: Array<{ id: string }> };
    expect(kaseki.status).toBe(200);
    expect(kaseki.headers.get("cache-control")).toBe("no-store");
    expect(kasekiBody.profiles.map((profile) => profile.id)).toEqual(["task_admission_v1", "validation_recovery_v1"]);

    const soyuz = await worker.fetch(request("/v1/profiles", { token: SOYUZ_TOKEN }), env);
    const soyuzBody = await soyuz.json() as { profiles: Array<{ id: string }> };
    expect(soyuzBody.profiles.map((profile) => profile.id)).toEqual([
      "run_operations_triage_v1", "kaseki_output_review_v1", "kaseki_output_review_v2",
    ]);
    expect(JSON.stringify(soyuzBody)).not.toContain("instructions");
    expect(JSON.stringify(soyuzBody)).not.toContain("allowedClients");
  });

  it("returns a public profile contract and consistently forbids another client's profile", async () => {
    const worker = createWorker({ logger: () => undefined });
    const allowed = await worker.fetch(request("/v1/profiles/run_operations_triage_v1", { token: SOYUZ_TOKEN }), env);
    const contract = await allowed.json() as Record<string, unknown>;
    expect(allowed.status).toBe(200);
    expect(contract).toMatchObject({
      schemaVersion: "1", id: "run_operations_triage_v1", version: "1", owner: "soyuz",
      operations: ["evaluate"], evaluationEndpoint: "/v1/profiles/{profileId}/evaluate",
    });
    expect(contract.inputSchema).toBeDefined();
    expect(contract.outputSchema).toBeDefined();
    expect(contract.limits).toMatchObject({ requestBytes: 128 * 1024, maxEvidenceBytes: 12 * 1024 });
    expect(contract).not.toHaveProperty("questions");

    const forbidden = await worker.fetch(request("/v1/profiles/task_admission_v1", { token: SOYUZ_TOKEN }), env);
    expect(forbidden.status).toBe(403);
    expect(JSON.stringify(await forbidden.json())).not.toContain("task_admission_v1");
  });

  it("keeps generic decisions Kaseki-only and ignores caller-supplied identity", async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => providerResponse(JSON.parse(String(init?.body)) as DecisionRequest));
    const worker = createWorker({ fetchImpl, logger: () => undefined });
    const genericBody = { schemaVersion: "1", state: { facts: ["bounded"] }, questions: {
      q: { type: "noul", instructions: "Is this likely?" },
    } };
    const soyuzGeneric = await worker.fetch(request("/v1/decisions", {
      method: "POST", token: SOYUZ_TOKEN, body: genericBody, contentType: "application/json",
    }), env);
    expect(soyuzGeneric.status).toBe(403);

    const forgedIdentity = await worker.fetch(request("/v1/profiles/run_operations_triage_v1/evaluate", {
      method: "POST", token: KASEKI_TOKEN, clientIdentityHeader: "soyuz",
      body: { schemaVersion: "1", clientId: "soyuz", input: scenarios[0].input }, contentType: "application/json",
    }), env);
    expect(forgedIdentity.status).toBe(403);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects malformed profile ids, unsupported envelopes, and invalid evidence without inference", async () => {
    const fetchImpl = vi.fn(async () => providerResponse({} as DecisionRequest));
    const worker = createWorker({ fetchImpl, logger: () => undefined });
    const cases = [
      { path: "/v1/profiles/unknown_profile/evaluate", body: { schemaVersion: "1", input: {} }, status: 403, code: "FORBIDDEN" },
      { path: "/v1/profiles/Run-Operations/evaluate", body: { schemaVersion: "1", input: {} }, status: 400, code: "INVALID_REQUEST" },
      { path: "/v1/profiles/task_admission_v1/evaluate", body: { schemaVersion: "2", input: {} }, status: 400, code: "UNSUPPORTED_SCHEMA_VERSION" },
      { path: "/v1/profiles/task_admission_v1/evaluate", body: { schemaVersion: "1", input: { repoUrl: "file:///tmp/repo" } }, status: 400, code: "INVALID_REQUEST" },
    ];
    for (const item of cases) {
      const response = await worker.fetch(request(item.path, {
        method: "POST", token: item.path.includes("task_admission") ? KASEKI_TOKEN : SOYUZ_TOKEN,
        body: item.body, contentType: "application/json",
      }), env);
      expect(response.status).toBe(item.status);
      expect((await response.json() as { error: { code: string } }).error.code).toBe(item.code);
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("maps projected profile evidence over its profile cap to 413 before provider invocation", async () => {
    const fetchImpl = vi.fn(async () => providerResponse({} as DecisionRequest));
    const oversizedInput = {
      repoUrl: "https://github.com/CyanAutomation/senku",
      taskPrompt: "t".repeat(16_000),
      validationCommands: Array.from({ length: 32 }, () => "c".repeat(512)),
      changedFilesAllowlist: Array.from({ length: 64 }, () => "f".repeat(512)),
    };
    const response = await createWorker({ fetchImpl, logger: () => undefined }).fetch(request("/v1/profiles/task_admission_v1/evaluate", {
      method: "POST", token: KASEKI_TOKEN,
      body: { schemaVersion: "1", input: oversizedInput }, contentType: "application/json",
    }), env);

    expect(response.status).toBe(413);
    expect((await response.json() as { error: { code: string } }).error.code).toBe("PAYLOAD_TOO_LARGE");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("maps provider failures and invalid results to safe errors without returning an assessment", async () => {
    const evidenceMarker = "private-evidence-marker";
    const failureLogs: Array<Record<string, unknown>> = [];
    const failure = await createWorker({
      fetchImpl: async () => new Response("upstream private response", { status: 503 }),
      logger: (record) => failureLogs.push(record as Record<string, unknown>),
    }).fetch(request("/v1/profiles/validation_recovery_v1/evaluate", {
      method: "POST", token: KASEKI_TOKEN,
      body: { schemaVersion: "1", input: { command: "npm test", exitCode: 1, output: evidenceMarker } }, contentType: "application/json",
    }), env);
    expect(failure.status).toBe(502);
    const failureBody = await failure.json() as { error: { code: string; retryable: boolean; requestId: string } };
    expect(failureBody.error).toMatchObject({ code: "PROVIDER_UNAVAILABLE", retryable: true });
    expect(failureBody.error.requestId).toMatch(/^dec-/);
    expect(JSON.stringify(failureBody)).not.toContain(evidenceMarker);
    expect(JSON.stringify(failureBody)).not.toContain("upstream private response");
    expect(failureBody).not.toHaveProperty("result");
    expect(failureLogs.at(-1)).toMatchObject({ event: "profile.evaluation_failed", attemptCount: 1 });

    const invalidOutput = await createWorker({
      fetchImpl: async (_input, init) => providerResponse(JSON.parse(String(init?.body)) as DecisionRequest, { invalid: true }),
      logger: () => undefined,
    }).fetch(request("/v1/profiles/validation_recovery_v1/evaluate", {
      method: "POST", token: KASEKI_TOKEN,
      body: { schemaVersion: "1", input: { command: "npm test", exitCode: 1, output: "safe" } }, contentType: "application/json",
    }), env);
    expect(invalidOutput.status).toBe(502);
    expect((await invalidOutput.json() as { error: { code: string } }).error.code).toBe("INVALID_PROVIDER_RESPONSE");
  });

  it("keeps caller evidence out of provider-visible logs", async () => {
    const evidenceMarker = "synthetic-password-do-not-log";
    const logs: Array<Record<string, unknown>> = [];
    let providerBody = "";
    const worker = createWorker({
      fetchImpl: async (_input, init) => {
        providerBody = String(init?.body);
        return providerResponse(JSON.parse(providerBody) as DecisionRequest);
      },
      logger: (record) => logs.push(record as Record<string, unknown>),
    });
    const response = await worker.fetch(request("/v1/profiles/validation_recovery_v1/evaluate", {
      method: "POST", token: KASEKI_TOKEN,
      body: { schemaVersion: "1", input: { command: "npm test", exitCode: 1, output: `password=${evidenceMarker}` } },
      contentType: "application/json",
    }), env);

    expect(response.status).toBe(200);
    expect(providerBody).not.toContain(evidenceMarker);
    expect(providerBody).toContain("[REDACTED_SECRET]");
    expect(JSON.stringify(logs)).not.toContain(evidenceMarker);
    expect(JSON.stringify(logs)).not.toContain("password=");
    expect(logs.at(-1)).toMatchObject({ event: "profile.evaluation_completed", attemptCount: 1 });

    const pathMarker = "synthetic_bearer_token_0123456789abcdef";
    const unknownProfile = await worker.fetch(request(`/v1/profiles/${pathMarker}`, { token: KASEKI_TOKEN }), env);
    expect(unknownProfile.status).toBe(403);
    expect(JSON.stringify(logs)).not.toContain(pathMarker);
    expect(logs.at(-1)).toMatchObject({ path: "/v1/profiles/{profileId}", errorCode: "FORBIDDEN" });
  });

  it("fails closed for duplicate or missing machine credentials", async () => {
    const worker = createWorker({ logger: () => undefined });
    const duplicate = await worker.fetch(request("/v1/profiles", { token: KASEKI_TOKEN }), {
      ...env, SENKU_SOYUZ_API_TOKEN: KASEKI_TOKEN,
    });
    expect(duplicate.status).toBe(503);
    const missing = await worker.fetch(request("/v1/profiles", { token: SOYUZ_TOKEN }), {
      ...env, SENKU_KASEKI_API_TOKEN: undefined,
    });
    expect(missing.status).toBe(503);
  });
});
