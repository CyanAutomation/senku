import { describe, expect, it } from "vitest";
import { createWorker } from "../src/index";
import { LIMITS, type DecisionRequest, type Environment } from "../src/contracts/decisions";
import { evaluateProfile } from "../src/decisions/profile-engine";

const environment: Environment = {
  OPENROUTER_API_KEY: "performance-test-key",
  SENKU_KASEKI_API_TOKEN: "performance-client-token-0123456789abcdef",
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

  it("measures representative internal profile-evaluation workloads without live inference", async () => {
    const profileInput = {
      repoUrl: "https://github.com/CyanAutomation/senku",
      ref: "main",
      taskPrompt: "Review this task evidence: " + "bounded operational evidence ".repeat(110),
      validationCommands: ["npm run typecheck", "npm test"],
      changedFilesAllowlist: ["src/**", "test/**"],
      taskMode: "patch",
      publishMode: "pr",
      startupCheck: false,
      scouting: { enabled: true, timeoutSeconds: 120 },
      goalSetting: { enabled: true, timeoutSeconds: 120 },
    };
    const fetchImpl: typeof fetch = async (_input, init) => mockedProviderResponse(JSON.parse(String(init?.body)) as DecisionRequest);
    const results: Array<{ profileId: string; evidenceBytes: number; averageWallMs: number; maxWallMs: number }> = [];
    const elapsed: number[] = [];
    let evidenceBytes = 0;
    for (let run = 0; run < 3; run += 1) {
      const started = performance.now();
      const result = await evaluateProfile("task_admission_v1", profileInput, { clientIdentity: "kaseki" }, {
        env: environment,
        fetchImpl,
      });
      elapsed.push(performance.now() - started);
      evidenceBytes = result.metadata.evidenceBytes;
    }
    results.push({
      profileId: "task_admission_v1",
      evidenceBytes,
      averageWallMs: Number((elapsed.reduce((sum, value) => sum + value, 0) / elapsed.length).toFixed(2)),
      maxWallMs: Number(Math.max(...elapsed).toFixed(2)),
    });
    console.log(JSON.stringify({
      benchmark: "local workerd profile wall-clock smoke; not billed CPU time",
      results,
    }));
    expect(results).toHaveLength(1);
    expect(evidenceBytes).toBeLessThanOrEqual(32 * 1024);
  });
});
