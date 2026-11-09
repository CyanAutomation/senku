import { describe, expect, it, vi } from "vitest";
import { createWorker } from "../src/index";
import { LIMITS, type DecisionRequest, type Environment } from "../src/contracts/decisions";

const environment: Environment = {
  OPENROUTER_API_KEY: "performance-test-key",
  SENKU_KASEKI_API_TOKEN: "performance-client-token-0123456789abcdef",
  SENKU_SOYUZ_API_TOKEN: "performance-soyuz-token-0123456789abcdef",
  SENKU_PUBLIC_BASE_URL: "https://senku.scheimann.workers.dev",
  JEV_MODEL: "~typesafe/jev-latest",
  SENKU_PROVIDER_TIMEOUT_MS: "15000",
};

function questions(count: number) {
  return Object.fromEntries(Array.from({ length: count }, (_unused, index) => [
    "question_" + index,
    { type: "noul", instructions: "Does the bounded evidence support this statement?" },
  ]));
}

function mockedProviderResponse(request: DecisionRequest): Response {
  const answers = Object.fromEntries(Object.entries(request.questions).map(([key, question]) => {
    if (question.type === "noul") return [key, { type: "noul", noul: 0.73 }];
    if (question.type === "choice") {
      const keys = Object.keys(question.criteria);
      return [key, {
        type: "choice",
        choice: keys[0],
        probabilities: Object.fromEntries(keys.map((choice, index) => [choice, index === 0 ? 1 : 0])),
        confidence: 0.9,
      }];
    }
    const keys = question.criteria.map((_criterion, index) => String(index));
    return [key, {
      type: "score",
      score: 0,
      legend: Object.fromEntries(question.criteria.map((criterion, index) => [String(index), String(criterion)])),
      probabilities: Object.fromEntries(keys.map((score, index) => [score, index === 0 ? 1 : 0])),
      confidence: null,
    }];
  }));
  return new Response(JSON.stringify({
    model: "typesafe/jev-1.14-20261014",
    answers,
    usage: { input_tokens: 18, output_tokens: 0 },
  }), { headers: { "content-type": "application/json" } });
}

describe("bounded request performance smoke", () => {
  it("measures permission-scoped discovery and OpenAPI serialization without provider calls", async () => {
    const provider = vi.fn(async () => new Response("{}", { status: 500 }));
    const worker = createWorker({ fetchImpl: provider, logger: () => undefined });
    const scenarios = [
      {
        identity: "kaseki" as const,
        token: "performance-client-token-0123456789abcdef",
        profiles: ["task_admission_v1", "validation_recovery_v1"],
      },
      {
        identity: "soyuz" as const,
        token: "performance-soyuz-token-0123456789abcdef",
        profiles: ["run_operations_triage_v1", "kaseki_output_review_v1", "kaseki_output_review_v2"],
      },
    ];
    const results: Array<{
      identity: string;
      endpoint: string;
      coldWallMs: number;
      warmAverageWallMs: number;
      warmMaxWallMs: number;
      responseBytes: number;
    }> = [];

    for (const scenario of scenarios) {
      const endpoints = ["/utcp", "/openapi.json", "/v1/profiles", ...scenario.profiles.map((profileId) => `/v1/profiles/${profileId}`)];
      for (const endpoint of endpoints) {
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
          expect(JSON.parse(body)).toBeDefined();
        }
        results.push({
          identity: scenario.identity,
          endpoint,
          coldWallMs: Number(elapsed[0].toFixed(2)),
          warmAverageWallMs: Number((elapsed.slice(1).reduce((sum, value) => sum + value, 0) / 4).toFixed(2)),
          warmMaxWallMs: Number(Math.max(...elapsed.slice(1)).toFixed(2)),
          responseBytes,
        });
      }
    }

    expect(provider).not.toHaveBeenCalled();
    console.log(JSON.stringify({
      benchmark: "local workerd discovery wall time; first request includes bounded generation, warm requests use cached JSON; not billed CPU",
      providerCalls: provider.mock.calls.length,
      results,
    }));
    expect(results).toHaveLength(11);
  });

  it("exercises small, typical, and upper-bound payloads in the Workers runtime", async () => {
    const makeBody = (questionCount: number, state: string | Record<string, unknown>) => JSON.stringify({
      schemaVersion: "1",
      state,
      questions: questions(questionCount),
    });
    const baseUpperBound = {
      schemaVersion: "1",
      state: "",
      questions: questions(LIMITS.questions),
    };
    const baseSize = new TextEncoder().encode(JSON.stringify(baseUpperBound)).byteLength;
    const upperBody = JSON.stringify({
      ...baseUpperBound,
      state: "x".repeat(LIMITS.requestBytes - baseSize),
    });
    const scenarios = [
      { name: "small", body: makeBody(1, { status: "failed", exitCode: 1 }) },
      { name: "typical", body: makeBody(8, { status: "failed", failureSummary: "Temporary timeout", evidence: "x".repeat(3_000) }) },
      { name: "upper-bound", body: upperBody },
    ];
    const worker = createWorker({
      fetchImpl: async (_input, init) => mockedProviderResponse(JSON.parse(String(init?.body)) as DecisionRequest),
      logger: () => undefined,
    });
    const results: Array<{ name: string; requestBytes: number; averageWallMs: number; maxWallMs: number }> = [];

    for (const scenario of scenarios) {
      const requestBytes = new TextEncoder().encode(scenario.body).byteLength;
      expect(requestBytes).toBeLessThanOrEqual(LIMITS.requestBytes);
      const elapsed: number[] = [];
      for (let run = 0; run < 3; run += 1) {
        const started = performance.now();
        const response = await worker.fetch(new Request("https://senku.test/v1/decisions", {
          method: "POST",
          headers: {
            authorization: "Bearer performance-client-token-0123456789abcdef",
            "content-type": "application/json",
          },
          body: scenario.body,
        }), environment);
        expect(response.status).toBe(200);
        elapsed.push(performance.now() - started);
      }
      results.push({
        name: scenario.name,
        requestBytes,
        averageWallMs: Number((elapsed.reduce((sum, value) => sum + value, 0) / elapsed.length).toFixed(2)),
        maxWallMs: Number(Math.max(...elapsed).toFixed(2)),
      });
    }

    console.log(JSON.stringify({
      benchmark: "local workerd wall-clock smoke; not billed CPU time",
      results,
    }));
    expect(results).toHaveLength(3);
  });

  it("measures complete HTTP profile evaluations through mocked JEV at representative maximum inputs", async () => {
    const maxTaskAdmissionInput = {
      repoUrl: "https://github.com/CyanAutomation/senku",
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
    const scenarios = [
      { id: "run_operations_triage_v1", token: "performance-soyuz-token-0123456789abcdef", input: { run: {
        status: "failed", stage: "s".repeat(128), operationalHealth: "suspect_stalled", failureClass: "f".repeat(128),
        createdAt: "2026-11-08T12:00:00.000Z", queuedAt: "2026-11-08T12:00:01.000Z", startedAt: "2026-11-08T12:00:02.000Z",
        completedAt: "2026-11-08T12:00:03.000Z", lastHeartbeatAt: "2026-11-08T12:00:02.500Z",
      } } },
      { id: "kaseki_output_review_v1", token: "performance-soyuz-token-0123456789abcdef", input: { canonicalRun: {
        status: "failed", failureClass: "f".repeat(128), exitCode: -1, changedFileCount: 1_000_000,
      }, summary: "s".repeat(2_000) } },
      { id: "kaseki_output_review_v2", token: "performance-soyuz-token-0123456789abcdef", input: { canonicalRun: {
        status: "failed", failureClass: "f".repeat(128), exitCode: 143, changedFileCount: 1_000_000,
      }, summary: "s".repeat(2_000) } },
      { id: "task_admission_v1", token: "performance-client-token-0123456789abcdef", input: maxTaskAdmissionInput },
      { id: "validation_recovery_v1", token: "performance-client-token-0123456789abcdef", input: {
        command: "npm test", exitCode: 1, output: "x".repeat(6_000),
      } },
    ];
    const results: Array<{
      profileId: string;
      requestBytes: number;
      evidenceBytes: number;
      questionCount: number;
      providerAttemptsPerRequest: number;
      providerCalls: number;
      averageWallMs: number;
      maxWallMs: number;
    }> = [];

    for (const scenario of scenarios) {
      const logs: Array<Record<string, unknown>> = [];
      let providerCalls = 0;
      const worker = createWorker({
        fetchImpl: async (_input, init) => {
          providerCalls += 1;
          return mockedProviderResponse(JSON.parse(String(init?.body)) as DecisionRequest);
        },
        logger: (record) => logs.push(record as Record<string, unknown>),
      });
      const body = JSON.stringify({ schemaVersion: "1", input: scenario.input });
      const requestBytes = new TextEncoder().encode(body).byteLength;
      expect(requestBytes).toBeLessThanOrEqual(LIMITS.requestBytes);
      const elapsed: number[] = [];
      for (let run = 0; run < 3; run += 1) {
        const started = performance.now();
        const response = await worker.fetch(new Request(`https://senku.test/v1/profiles/${scenario.id}/evaluate`, {
          method: "POST",
          headers: { authorization: `Bearer ${scenario.token}`, "content-type": "application/json" },
          body,
        }), environment);
        expect(response.status).toBe(200);
        const responseBody = await response.json() as { attemptCount: number };
        expect(responseBody.attemptCount).toBe(1);
        elapsed.push(performance.now() - started);
      }
      const lastLog = logs.at(-1)!;
      results.push({
        profileId: scenario.id,
        requestBytes,
        evidenceBytes: Number(lastLog.evidenceBytes),
        questionCount: Number(lastLog.questionCount),
        providerAttemptsPerRequest: Number(lastLog.attemptCount),
        providerCalls,
        averageWallMs: Number((elapsed.reduce((sum, value) => sum + value, 0) / elapsed.length).toFixed(2)),
        maxWallMs: Number(Math.max(...elapsed).toFixed(2)),
      });
      expect(lastLog.event).toBe("profile.evaluation_completed");
      expect(lastLog.attemptCount).toBe(1);
      expect(providerCalls).toBe(3);
    }

    console.log(JSON.stringify({
      benchmark: "local workerd full HTTP profile path; mocked provider; wall time is not billed CPU",
      results,
    }));
    expect(results).toHaveLength(5);
    expect(results.find((item) => item.profileId === "task_admission_v1")!.evidenceBytes).toBeLessThanOrEqual(32 * 1024);
  });
});
