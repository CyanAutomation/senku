import { HttpCallTemplateSerializer } from "@utcp/http";
import { UtcpClient, UtcpClientConfigSerializer, UtcpManualSchema } from "@utcp/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildOpenApiDocument } from "../src/api/openapi";
import { buildUtcpManual, projectJsonSchemaForUtcp, serializeUtcpManual, trustedSenkuOrigin } from "../src/api/utcp";
import type { DecisionRequest, Environment } from "../src/contracts/decisions";
import { profileAnswersSchema, profileEvaluationResponseSchema } from "../src/api/profile-contracts";
import { profileRegistry } from "../src/decisions/profile-registry";
import { createWorker } from "../src/index";

const KASEKI_TOKEN = "utcp-kaseki-synthetic-token-0123456789abcdef";
const SOYUZ_TOKEN = "utcp-soyuz-synthetic-token-0123456789abcdef";
const OPENROUTER_KEY = "synthetic-openrouter-secret-never-in-manual";
const LOCAL_BASE_URL = "http://127.0.0.1:8787";

const environment: Environment = {
  OPENROUTER_API_KEY: OPENROUTER_KEY,
  SENKU_KASEKI_API_TOKEN: KASEKI_TOKEN,
  SENKU_SOYUZ_API_TOKEN: SOYUZ_TOKEN,
  SENKU_PUBLIC_BASE_URL: LOCAL_BASE_URL,
  JEV_MODEL: "~typesafe/jev-latest",
  SENKU_PROVIDER_TIMEOUT_MS: "15000",
};

// Contract basis: docs/UTCP.md, discovery permissions, request mapping, and schema projection.
interface WorkerRequestRecord {
  method: string;
  pathname: string;
  search: string;
  authorization: string | null;
  contentType: string | null;
  body: string;
  responseBody: string;
  status: number;
}

function providerResponse(request: DecisionRequest): Response {
  const answers = Object.fromEntries(Object.entries(request.questions).map(([key, question]) => {
    if (question.type === "noul") return [key, { type: "noul", noul: 0.75 }];
    if (question.type === "choice") {
      const keys = Object.keys(question.criteria);
      return [key, {
        type: "choice",
        choice: keys[0],
        probabilities: Object.fromEntries(keys.map((choice, index) => [choice, index === 0 ? 1 : 0])),
        confidence: null,
      }];
    }
    const keys = question.criteria.map((_criterion, index) => String(index));
    return [key, {
      type: "score",
      score: 0,
      legend: Object.fromEntries(question.criteria.map((criterion, index) => [String(index), typeof criterion === "string" ? criterion : JSON.stringify(criterion)])),
      probabilities: Object.fromEntries(keys.map((score, index) => [score, index === 0 ? 1 : 0])),
      confidence: null,
    }];
  }));
  return new Response(JSON.stringify({ model: "typesafe/jev-1.14-20261014", answers }), {
    headers: { "content-type": "application/json" },
  });
}

function installWorkerFetchBridge(
  worker: ReturnType<typeof createWorker>,
  records: WorkerRequestRecord[],
  env: Environment,
): void {
  // Each client gets a fetch stub that closes over its own Worker and request log.
  vi.unstubAllGlobals();
  const originalFetch = globalThis.fetch;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? new Request(input, init) : new Request(input, init);
    const url = new URL(request.url);
    if (url.origin !== LOCAL_BASE_URL) return originalFetch(input, init);

    const body = request.method === "GET" || request.method === "HEAD" ? "" : await request.clone().text();
    const response = await worker.fetch(request, env);
    const responseBody = await response.clone().text();
    records.push({
      method: request.method,
      pathname: url.pathname,
      search: url.search,
      authorization: request.headers.get("authorization"),
      contentType: request.headers.get("content-type"),
      body,
      responseBody,
      status: response.status,
    });
    return response;
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

async function startClient(
  token: string,
  worker: ReturnType<typeof createWorker>,
  records: WorkerRequestRecord[],
  env: Environment = environment,
): Promise<UtcpClient> {
  installWorkerFetchBridge(worker, records, env);
  const serializer = new HttpCallTemplateSerializer();
  const manualTemplate = serializer.validateDict({
    name: "senku",
    call_template_type: "http",
    url: `${LOCAL_BASE_URL}/utcp`,
    http_method: "GET",
    content_type: "application/json",
    auth: {
      auth_type: "api_key",
      api_key: "Bearer ${SENKU_API_TOKEN}",
      var_name: "Authorization",
      location: "header",
    },
  });
  const config = new UtcpClientConfigSerializer().validateDict({
    variables: { senku_SENKU_API_TOKEN: token },
    manual_call_templates: [manualTemplate],
  });
  return UtcpClient.create(".", config);
}

const taskAdmissionRequest = {
  schemaVersion: "1",
  input: {
    repoUrl: "https://github.com/CyanAutomation/senku",
    taskPrompt: "Assess this bounded example task.",
  },
};

const runTriageRequest = {
  schemaVersion: "1",
  input: {
    run: {
      status: "failed",
      stage: "validation",
      operationalHealth: "suspect_stalled",
      failureClass: "provider_failure",
      createdAt: "2026-11-08T12:00:00.000Z",
      queuedAt: "2026-11-08T12:00:01.000Z",
      startedAt: "2026-11-08T12:00:02.000Z",
      completedAt: "2026-11-08T12:00:03.000Z",
      lastHeartbeatAt: "2026-11-08T12:00:02.500Z",
    },
  },
};

describe("authenticated UTCP discovery and HTTP invocation", () => {
  it("generates an SDK-valid, permission-filtered UTCP 1.1 manual", () => {
    const kaseki = buildUtcpManual("kaseki", LOCAL_BASE_URL)!;
    const soyuz = buildUtcpManual("soyuz", LOCAL_BASE_URL)!;
    expect(UtcpManualSchema.parse(kaseki)).toEqual(kaseki);
    expect(UtcpManualSchema.parse(soyuz)).toEqual(soyuz);
    expect(kaseki).toMatchObject({ utcp_version: "1.1", manual_version: "1.0.0" });
    expect(kaseki.tools.map((tool) => tool.name)).toEqual(["assess_task_admission", "assess_validation_recovery"]);
    expect(soyuz.tools.map((tool) => tool.name)).toEqual(["triage_run_evidence", "review_kaseki_output_v1", "review_kaseki_output_v2"]);

    for (const tool of [...kaseki.tools, ...soyuz.tools]) {
      expect(tool.tool_call_template).toMatchObject({
        call_template_type: "http",
        http_method: "POST",
        content_type: "application/json",
        body_field: "request",
        auth: { auth_type: "api_key", api_key: "Bearer ${SENKU_API_TOKEN}", var_name: "Authorization", location: "header" },
      });
      expect(tool.tool_call_template.url).toMatch(/^https?:\/\/127\.0\.0\.1:8787\/v1\/profiles\/[a-z0-9_]+\/evaluate$/);
      expect(JSON.stringify(tool.inputs)).toContain('"schemaVersion"');
      expect(JSON.stringify(tool.outputs)).toContain('"confidence"');
      expect(JSON.stringify(tool)).not.toMatch(/SENKU_(?:KASEKI|SOYUZ)_API_TOKEN|OPENROUTER_API_KEY/);
      expect(JSON.stringify(tool)).not.toContain(OPENROUTER_KEY);
      expect(JSON.stringify(tool.inputs)).not.toMatch(/\$ref|oneOf|anyOf/);
      expect(JSON.stringify([tool.inputs, tool.outputs])).not.toMatch(/"x-[^"]+"\s*:/);
      const profileId = /\/v1\/profiles\/([a-z0-9_]+)\/evaluate$/.exec(tool.tool_call_template.url)![1];
      const profile = profileRegistry.getProfile(profileId);
      expect((tool.inputs as { properties: { request: { properties: { input: unknown } } } }).properties.request.properties.input)
        .toEqual(projectJsonSchemaForUtcp(profile.inputSchema));
      expect(tool.outputs).toEqual(projectJsonSchemaForUtcp(profileEvaluationResponseSchema(profile, profileAnswersSchema(profile))));
    }
    expect(JSON.stringify(kaseki)).not.toContain("/v1/decisions");
    expect(JSON.stringify(kaseki)).not.toContain("openrouter.ai");

    const malformed = structuredClone(kaseki);
    (malformed.tools[0] as unknown as { description: string }).description = null as unknown as string;
    expect(() => UtcpManualSchema.parse(malformed)).toThrow();
  });

  it("discovers and invokes a Kaseki tool using the official UTCP client and exact request body", async () => {
    const provider = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
      providerResponse(JSON.parse(String(init?.body)) as DecisionRequest));
    const worker = createWorker({ fetchImpl: provider, logger: () => undefined });
    const requests: WorkerRequestRecord[] = [];
    const client = await startClient(KASEKI_TOKEN, worker, requests);
    try {
      const tools = await client.getTools();
      expect(tools.map((tool) => tool.name)).toEqual([
        "senku.assess_task_admission",
        "senku.assess_validation_recovery",
      ]);
      expect(provider).not.toHaveBeenCalled();
      expect(requests[0]).toMatchObject({ method: "GET", pathname: "/utcp", search: "", authorization: `Bearer ${KASEKI_TOKEN}` });

      const started = performance.now();
      const result = await client.callTool("senku.assess_task_admission", { request: taskAdmissionRequest }) as Record<string, unknown>;
      const evaluationWallMs = Number((performance.now() - started).toFixed(2));
      expect(result).toMatchObject({ schemaVersion: "1", status: "completed", profileId: "task_admission_v1", attemptCount: 1 });
      expect(provider).toHaveBeenCalledTimes(1);
      expect(requests[1]).toMatchObject({
        method: "POST",
        pathname: "/v1/profiles/task_admission_v1/evaluate",
        search: "",
        authorization: `Bearer ${KASEKI_TOKEN}`,
        contentType: "application/json",
      });
      expect(JSON.parse(requests[1].body)).toEqual(taskAdmissionRequest);
      console.log(JSON.stringify({ benchmark: "official UTCP client Kaseki evaluation; mocked provider; local wall time is not billed CPU", evaluationWallMs, providerCalls: provider.mock.calls.length }));
    } finally {
      await client.close();
    }
  });

  it("discovers and invokes a Soyuz tool with the same REST profile path", async () => {
    const provider = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
      providerResponse(JSON.parse(String(init?.body)) as DecisionRequest));
    const worker = createWorker({ fetchImpl: provider, logger: () => undefined });
    const requests: WorkerRequestRecord[] = [];
    const client = await startClient(SOYUZ_TOKEN, worker, requests);
    try {
      const tools = await client.getTools();
      expect(tools.map((tool) => tool.name)).toEqual([
        "senku.triage_run_evidence",
        "senku.review_kaseki_output_v1",
        "senku.review_kaseki_output_v2",
      ]);
      expect(provider).not.toHaveBeenCalled();

      const started = performance.now();
      const result = await client.callTool("senku.triage_run_evidence", { request: runTriageRequest }) as Record<string, unknown>;
      const evaluationWallMs = Number((performance.now() - started).toFixed(2));
      expect(result).toMatchObject({ schemaVersion: "1", status: "completed", profileId: "run_operations_triage_v1", attemptCount: 1 });
      expect(provider).toHaveBeenCalledTimes(1);
      expect(requests[1]).toMatchObject({ method: "POST", pathname: "/v1/profiles/run_operations_triage_v1/evaluate", search: "", authorization: `Bearer ${SOYUZ_TOKEN}` });
      expect(JSON.parse(requests[1].body)).toEqual(runTriageRequest);
      console.log(JSON.stringify({ benchmark: "official UTCP client Soyuz evaluation; mocked provider; local wall time is not billed CPU", evaluationWallMs, providerCalls: provider.mock.calls.length }));
    } finally {
      await client.close();
    }
  });

  it("rejects unauthenticated discovery, forbidden profiles, and hostile host headers without inference", async () => {
    const provider = vi.fn(async () => providerResponse({} as DecisionRequest));
    const worker = createWorker({ fetchImpl: provider, logger: () => undefined });
    const unauthenticated = await worker.fetch(new Request("https://attacker.example/utcp"), environment);
    expect(unauthenticated.status).toBe(401);
    expect(unauthenticated.headers.get("cache-control")).toBe("no-store");

    const invalidToken = await worker.fetch(new Request("https://attacker.example/utcp", {
      headers: { authorization: "Bearer invalid-token-that-is-long-enough" },
    }), environment);
    expect(invalidToken.status).toBe(401);

    const invalidConfiguration = await worker.fetch(new Request("https://senku.test/utcp", {
      headers: { authorization: `Bearer ${KASEKI_TOKEN}` },
    }), { ...environment, SENKU_SOYUZ_API_TOKEN: undefined });
    expect(invalidConfiguration.status).toBe(503);

    const unauthenticatedEvaluation = await worker.fetch(new Request("https://senku.test/v1/profiles/task_admission_v1/evaluate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(taskAdmissionRequest),
    }), environment);
    expect(unauthenticatedEvaluation.status).toBe(401);

    const hostInjected = await worker.fetch(new Request("https://attacker.example/utcp", {
      headers: { authorization: `Bearer ${KASEKI_TOKEN}`, "x-forwarded-host": "evil.example" },
    }), environment);
    const manual = await hostInjected.json() as { tools: Array<{ tool_call_template: { url: string } }> };
    expect(hostInjected.status).toBe(200);
    expect(manual.tools.every((tool) => tool.tool_call_template.url.startsWith("http://127.0.0.1:8787/"))).toBe(true);

    const forbidden = await worker.fetch(new Request("https://senku.test/v1/profiles/run_operations_triage_v1/evaluate", {
      method: "POST",
      headers: { authorization: `Bearer ${KASEKI_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify(runTriageRequest),
    }), environment);
    expect(forbidden.status).toBe(403);

    const reverseForbidden = await worker.fetch(new Request("https://senku.test/v1/profiles/task_admission_v1/evaluate", {
      method: "POST",
      headers: { authorization: `Bearer ${SOYUZ_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify(taskAdmissionRequest),
    }), environment);
    expect(reverseForbidden.status).toBe(403);
    expect(provider).not.toHaveBeenCalled();
  });

  it("maps manual-generation failures to a safe structured error", async () => {
    const logs: Array<Record<string, unknown>> = [];
    const worker = createWorker({
      logger: (record) => logs.push(record as Record<string, unknown>),
      serializeUtcpManual: () => { throw new Error("private manual-generation detail"); },
    });
    const response = await worker.fetch(new Request("https://senku.test/utcp", {
      headers: { authorization: `Bearer ${KASEKI_TOKEN}` },
    }), environment);
    const body = await response.text();

    expect(response.status).toBe(500);
    expect(JSON.parse(body)).toMatchObject({ error: { code: "INTERNAL_ERROR" } });
    expect(body).not.toContain("private manual-generation detail");
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ event: "profile.request_failed", path: "/utcp", errorCode: "INTERNAL_ERROR" });
    expect(JSON.stringify(logs)).not.toContain("private manual-generation detail");
  });

  it("rejects unsafe public base URLs and normalizes loopback origins", async () => {
    for (const invalid of [
      undefined,
      "http://senku.example.com",
      "https://user:pass@senku.example.com",
      "https://senku.example.com/path",
      "https://senku.example.com?token=secret",
      "https://senku.example.com#manual",
      "file:///tmp/senku",
      "http://127.0.0.1e0",
      "http://127.1e2.0.1",
      "http://127..0.1",
    ]) {
      expect(trustedSenkuOrigin(invalid)).toBeNull();
      const response = await createWorker({ logger: () => undefined }).fetch(new Request("https://senku.test/utcp", {
        headers: { authorization: `Bearer ${KASEKI_TOKEN}` },
      }), { ...environment, SENKU_PUBLIC_BASE_URL: invalid });
      expect(response.status).toBe(503);
    }
    expect(trustedSenkuOrigin("http://localhost:8787/")).toBe("http://localhost:8787");
    expect(trustedSenkuOrigin("http://[::1]:8787")).toBe("http://[::1]:8787");
  });

  it("rejects a UTCP invocation with the wrong body mapping before provider inference", async () => {
    const provider = vi.fn(async () => providerResponse({} as DecisionRequest));
    const worker = createWorker({ fetchImpl: provider, logger: () => undefined });
    const requests: WorkerRequestRecord[] = [];
    const client = await startClient(KASEKI_TOKEN, worker, requests);
    try {
      const tool = await client.getTool("senku.assess_task_admission");
      expect(tool).toBeDefined();
      tool!.tool_call_template.body_field = "body";
      const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
      try {
        await expect(client.callTool("senku.assess_task_admission", { request: taskAdmissionRequest })).rejects.toThrow();
      } finally {
        errorLog.mockRestore();
      }
      expect(requests.at(-1)).toMatchObject({ method: "POST", pathname: "/v1/profiles/task_admission_v1/evaluate", contentType: "application/x-www-form-urlencoded", status: 415 });
      expect(requests.at(-1)!.search).toContain("request%5BschemaVersion%5D");
      expect(provider).not.toHaveBeenCalled();
    } finally {
      await client.close();
    }
  });

  it("rejects malformed and oversized profile envelopes through the UTCP client", async () => {
    const provider = vi.fn(async () => providerResponse({} as DecisionRequest));
    const worker = createWorker({ fetchImpl: provider, logger: () => undefined });
    const malformedCases = [
      { ...taskAdmissionRequest, schemaVersion: "2" },
      { schemaVersion: "1", input: { repoUrl: "file:///etc/passwd", taskPrompt: "private-invalid-evidence-marker" } },
      { schemaVersion: "1", input: {
        repoUrl: "https://github.com/CyanAutomation/senku",
        taskPrompt: "t".repeat(16_000),
        validationCommands: Array.from({ length: 32 }, () => "c".repeat(512)),
        changedFilesAllowlist: Array.from({ length: 64 }, () => "f".repeat(512)),
      } },
    ];
    const invalidRequests: WorkerRequestRecord[] = [];
    const invalidClient = await startClient(KASEKI_TOKEN, worker, invalidRequests);
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      expect(await invalidClient.getTool("senku.assess_task_admission")).toBeDefined();
      for (const request of malformedCases) {
        await expect(invalidClient.callTool("senku.assess_task_admission", { request })).rejects.toThrow();
      }
      expect(invalidRequests.slice(1).map((item) => item.status)).toEqual([400, 400, 413]);
      expect(invalidRequests.slice(1).every((item) => !item.responseBody.includes(OPENROUTER_KEY))).toBe(true);
      expect(invalidRequests[2].responseBody).not.toContain("private-invalid-evidence-marker");
      expect(provider).not.toHaveBeenCalled();
    } finally {
      errorLog.mockRestore();
      await invalidClient.close();
    }
  });

  it("keeps the UTCP projection portable while retaining registered field constraints", () => {
    const schema = projectJsonSchemaForUtcp({
      type: "string",
      maxLength: 200,
      "x-maxBytes": 400,
      "x-disallowUserInfo": true,
      description: "Repository URL.",
    });
    expect(schema).toEqual({
      type: "string",
      maxLength: 200,
      description: "Repository URL. Senku also enforces a UTF-8 byte limit of 400 bytes. The URI must not contain a username or password.",
    });
    const nested = projectJsonSchemaForUtcp({
      type: "object",
      properties: {
        repoUrl: { type: "string", "x-maxBytes": 1_024, "x-disallowQuery": true },
        run: {
          type: "object",
          properties: { stage: { type: "string", "x-maxBytes": 128 } },
        },
      },
      items: { properties: { output: { type: "string", "x-maxBytes": 2_000 } } },
    });
    expect(nested).toMatchObject({
      properties: {
        repoUrl: { description: "Senku also enforces a UTF-8 byte limit of 1024 bytes. The URI must not contain a query string." },
        run: { properties: { stage: { description: "Senku also enforces a UTF-8 byte limit of 128 bytes." } } },
      },
      items: { properties: { output: { description: "Senku also enforces a UTF-8 byte limit of 2000 bytes." } } },
    });
    expect(JSON.stringify(nested)).not.toMatch(/"x-[^"]+"\s*:/);
    expect(serializeUtcpManual("kaseki", LOCAL_BASE_URL)).not.toContain(OPENROUTER_KEY);

    const openapi = buildOpenApiDocument("kaseki") as { paths: Record<string, unknown> };
    expect(openapi.paths).toHaveProperty("/utcp");
  });
});
