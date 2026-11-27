import { expect, it, vi } from "vitest";
import { type ProfileId } from "../src/auth/permissions";
import { LIMITS, type DecisionRequest } from "../src/contracts/decisions";
import { profileRegistry } from "../src/decisions/profile-registry";
import { createWorker } from "../src/index";
import { makeTestEnvironment } from "./helpers/environment";
import { providerResponse } from "./helpers/provider-response";

// Benchmark-only: npm run perf:smoke. Wall-clock results are informational and have no pass/fail threshold.
// Measurement basis: docs/PHASE-2C-DECISIONS.md#discovery-contracts-and-bundle.
const environment = makeTestEnvironment("performance");

interface DiscoveryScenario {
  identity: "kaseki" | "soyuz";
  token: string;
  profiles: ProfileId[];
}

interface DiscoveryResult {
  identity: string;
  endpoint: string;
  coldWallMs: number;
  warmAverageWallMs: number;
  warmMaxWallMs: number;
  responseBytes: number;
}

interface ProfileScenario {
  id: ProfileId;
  token: string;
  input: Record<string, unknown>;
}

interface ProfileResult {
  profileId: string;
  requestBytes: number;
  evidenceBytes: number;
  questionCount: number;
  providerAttemptsPerRequest: number;
  providerCalls: number;
  averageWallMs: number;
  maxWallMs: number;
}

function discoveryScenarios(): DiscoveryScenario[] {
  return [
    {
      identity: "kaseki",
      token: environment.SENKU_KASEKI_API_TOKEN!,
      profiles: [
        "task_admission_v1",
        "kaseki_goal_check_v1",
        "kaseki_run_evaluation_v1",
        "kaseki_context_routing_v1",
        "validation_recovery_v1",
      ],
    },
    {
      identity: "soyuz",
      token: environment.SENKU_SOYUZ_API_TOKEN!,
      profiles: ["run_operations_triage_v1", "kaseki_output_review_v1", "kaseki_output_review_v2", "run_retry_review_v1"],
    },
  ];
}

function discoveryEndpoints(scenario: DiscoveryScenario): string[] {
  return ["/utcp", "/openapi.json", "/v1/profiles", ...scenario.profiles.map((profileId) => `/v1/profiles/${profileId}`)];
}

function assertDiscoveryBody(endpoint: string, scenario: DiscoveryScenario, body: string): void {
  const document = JSON.parse(body) as Record<string, unknown>;
  if (endpoint === "/v1/profiles") {
    const profileIds = (document.profiles as Array<{ id: string }>).map((profile) => profile.id).sort();
    expect(profileIds).toEqual([...scenario.profiles].sort());
    return;
  }
  if (endpoint === "/utcp") {
    const toolProfileIds = (document.tools as Array<{ tool_call_template: { url: string } }>).map((tool) => {
      const match = /\/v1\/profiles\/([a-z0-9_]+)\/evaluate$/.exec(tool.tool_call_template.url);
      expect(match).not.toBeNull();
      return match![1];
    }).sort();
    expect(toolProfileIds).toEqual([...scenario.profiles].sort());
    return;
  }
  if (endpoint === "/openapi.json") {
    const paths = document.paths as Record<string, unknown>;
    expect(paths).toHaveProperty("/v1/profiles/{profileId}/evaluate");
    expect(Object.hasOwn(paths, "/v1/decisions")).toBe(false);
    return;
  }
  expect(document.id).toBe(endpoint.split("/").at(-1));
}

async function benchmarkDiscoveryEndpoint(
  worker: ReturnType<typeof createWorker>,
  scenario: DiscoveryScenario,
  endpoint: string,
): Promise<DiscoveryResult> {
  const elapsed: number[] = [];
  let responseBytes = 0;
  for (let run = 0; run < 5; run += 1) {
    const started = performance.now();
    const response = await worker.fetch(new Request(`https://senku.test${endpoint}`, {
      headers: { authorization: `Bearer ${scenario.token}` },
    }), environment);
    const body = await response.text();
    elapsed.push(performance.now() - started);
    responseBytes = new TextEncoder().encode(body).byteLength;
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    if (run === 0) assertDiscoveryBody(endpoint, scenario, body);
  }
  return {
    identity: scenario.identity,
    endpoint,
    coldWallMs: Number(elapsed[0].toFixed(2)),
    warmAverageWallMs: Number((elapsed.slice(1).reduce((sum, value) => sum + value, 0) / 4).toFixed(2)),
    warmMaxWallMs: Number(Math.max(...elapsed.slice(1)).toFixed(2)),
    responseBytes,
  };
}

async function benchmarkDiscovery(worker: ReturnType<typeof createWorker>): Promise<DiscoveryResult[]> {
  const results: DiscoveryResult[] = [];
  for (const scenario of discoveryScenarios()) {
    for (const endpoint of discoveryEndpoints(scenario)) {
      results.push(await benchmarkDiscoveryEndpoint(worker, scenario, endpoint));
    }
  }
  return results;
}

function profileScenarios(): ProfileScenario[] {
  const maxTaskAdmissionInput = {
    repoUrl: "https://code.example.invalid/org/repository",
    ref: "r".repeat(256),
    taskPrompt: "t".repeat(9_000),
    validationCommands: Array.from({ length: 14 }, () => "c".repeat(450)),
    changedFilesAllowlist: Array.from({ length: 38 }, () => "f".repeat(410)),
    taskMode: "patch",
    publishMode: "pr",
    startupCheck: true,
    scouting: { enabled: true, model: "s".repeat(255), timeoutSeconds: 10_800 },
    goalSetting: { enabled: true, model: "g".repeat(255), timeoutSeconds: 10_800 },
  };
  return [
    { id: "run_operations_triage_v1", token: environment.SENKU_SOYUZ_API_TOKEN!, input: { run: {
      status: "failed", stage: "s".repeat(128), operationalHealth: "suspect_stalled", failureClass: "f".repeat(128),
      createdAt: "2026-11-08T12:00:00.000Z", queuedAt: "2026-11-08T12:00:01.000Z", startedAt: "2026-11-08T12:00:02.000Z",
      completedAt: "2026-11-08T12:00:03.000Z", lastHeartbeatAt: "2026-11-08T12:00:02.500Z",
    } } },
    { id: "kaseki_output_review_v1", token: environment.SENKU_SOYUZ_API_TOKEN!, input: { canonicalRun: {
      status: "failed", failureClass: "f".repeat(128), exitCode: -1, changedFileCount: 1_000_000,
    }, summary: "s".repeat(2_000) } },
    { id: "kaseki_output_review_v2", token: environment.SENKU_SOYUZ_API_TOKEN!, input: { canonicalRun: {
      status: "failed", failureClass: "f".repeat(128), exitCode: 143, changedFileCount: 1_000_000,
    }, summary: "s".repeat(2_000) } },
    { id: "run_retry_review_v1", token: environment.SENKU_SOYUZ_API_TOKEN!, input: { retryComparison: {
      source: { status: "failed", failureClass: "f".repeat(128), exitCode: 1, changedFileCount: 1_000_000, summary: "s".repeat(2_000) },
      retry: { status: "completed", failureClass: null, exitCode: 0, changedFileCount: 1_000_000, summary: "r".repeat(2_000) },
    } } },
    { id: "task_admission_v1", token: environment.SENKU_KASEKI_API_TOKEN!, input: maxTaskAdmissionInput },
    { id: "validation_recovery_v1", token: environment.SENKU_KASEKI_API_TOKEN!, input: {
      command: "npm test", exitCode: 1, output: "x".repeat(6_000),
    } },
  ];
}

async function evaluateProfileOnce(
  worker: ReturnType<typeof createWorker>,
  scenario: ProfileScenario,
  body: string,
): Promise<{ responseBody: { schemaVersion: string; status: string; profileId: string; answers: Record<string, unknown>; attemptCount: number }; elapsedMs: number }> {
  const started = performance.now();
  const response = await worker.fetch(new Request(`https://senku.test/v1/profiles/${scenario.id}/evaluate`, {
    method: "POST",
    headers: { authorization: `Bearer ${scenario.token}`, "content-type": "application/json" },
    body,
  }), environment);
  const responseBody = await response.json() as {
    schemaVersion: string;
    status: string;
    profileId: string;
    answers: Record<string, unknown>;
    attemptCount: number;
  };
  expect(response.status).toBe(200);
  return { responseBody, elapsedMs: performance.now() - started };
}

async function benchmarkProfileScenario(scenario: ProfileScenario): Promise<ProfileResult> {
  const logs: Array<Record<string, unknown>> = [];
  let providerCalls = 0;
  const worker = createWorker({
    fetchImpl: async (_input, init) => {
      providerCalls += 1;
      return providerResponse(JSON.parse(String(init?.body)) as DecisionRequest, {
        noul: 0.73,
        choiceConfidence: 0.9,
        usage: { input_tokens: 18, output_tokens: 0 },
      });
    },
    logger: (record) => logs.push(record as Record<string, unknown>),
  });
  const body = JSON.stringify({ schemaVersion: "1", input: scenario.input });
  const requestBytes = new TextEncoder().encode(body).byteLength;
  expect(requestBytes).toBeLessThanOrEqual(LIMITS.requestBytes);
  const profile = profileRegistry.getProfile(scenario.id);
  const elapsed: number[] = [];

  for (let run = 0; run < 3; run += 1) {
    const result = await evaluateProfileOnce(worker, scenario, body);
    elapsed.push(result.elapsedMs);
    if (run === 0) {
      expect(result.responseBody).toMatchObject({
        schemaVersion: "1",
        status: "completed",
        profileId: scenario.id,
        attemptCount: 1,
      });
      expect(Object.keys(result.responseBody.answers).sort()).toEqual(Object.keys(profile.questions).sort());
    }
  }

  const lastLog = logs.at(-1)!;
  expect(lastLog).toMatchObject({
    event: "profile.evaluation_completed",
    profileId: scenario.id,
    attemptCount: 1,
    questionCount: Object.keys(profile.questions).length,
  });
  expect(Number(lastLog.evidenceBytes)).toBeLessThanOrEqual(profile.maxEvidenceBytes);
  expect(lastLog.event).toBe("profile.evaluation_completed");
  expect(lastLog.attemptCount).toBe(1);
  expect(providerCalls).toBe(3);

  return {
    profileId: scenario.id,
    requestBytes,
    evidenceBytes: Number(lastLog.evidenceBytes),
    questionCount: Number(lastLog.questionCount),
    providerAttemptsPerRequest: Number(lastLog.attemptCount),
    providerCalls,
    averageWallMs: Number((elapsed.reduce((sum, value) => sum + value, 0) / elapsed.length).toFixed(2)),
    maxWallMs: Number(Math.max(...elapsed).toFixed(2)),
  };
}

it("benchmarks permission-scoped discovery and OpenAPI serialization without provider calls", async () => {
  const provider = vi.fn(async () => new Response("{}", { status: 500 }));
  const worker = createWorker({ fetchImpl: provider, logger: () => undefined });
  const results = await benchmarkDiscovery(worker);

  expect(provider).not.toHaveBeenCalled();
  console.log(JSON.stringify({
    benchmark: "local workerd discovery wall time; first request includes bounded generation, warm requests use cached JSON; not billed CPU",
    providerCalls: provider.mock.calls.length,
    results,
  }));
  expect(results).toHaveLength(15);
});

it("benchmarks complete HTTP profile evaluations through mocked JEV at representative maximum inputs", async () => {
  const scenarios = profileScenarios();
  const results: ProfileResult[] = [];
  for (const scenario of scenarios) results.push(await benchmarkProfileScenario(scenario));

  console.log(JSON.stringify({
    benchmark: "local workerd full HTTP profile path; mocked provider; wall time is not billed CPU",
    results,
  }));
  expect(results).toHaveLength(6);
  expect(results.map((item) => item.profileId).sort()).toEqual(scenarios.map((item) => item.id).sort());
});
