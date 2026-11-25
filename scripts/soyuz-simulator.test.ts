import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createTestHarness } from "wrangler";
import type { DecisionRequest } from "../src/contracts/decisions.ts";
import { providerResponse } from "../test/helpers/provider-response.ts";

const SOYUZ_USER_TOKEN = "soyuz-simulator-user-token-0000000000000000";
const SOYUZ_MACHINE_TOKEN = "soyuz-simulator-machine-token-0000000000000000";
const KASEKI_MACHINE_TOKEN = "kaseki-simulator-machine-token-0000000000000000";
const OPENROUTER_KEY = "synthetic-openrouter-key-not-a-real-secret";
const TASK_MARKER = "SYNTHETIC_SOYUZ_TASK_PROMPT_MUST_STAY_IN_SOYUZ";
const OPENROUTER_URL = "https://openrouter.ai/api/alpha/decisions";
const SOURCE_RUN_ID = "11111111-1111-4111-8111-111111111111";
const RETRY_RUN_ID = "22222222-2222-4222-8222-222222222222";

const scenarios = [
  { profileId: "run_operations_triage_v1", runId: SOURCE_RUN_ID, answers: ["needs_followup", "likely_area", "severity"] },
  { profileId: "kaseki_output_review_v1", runId: RETRY_RUN_ID, answers: ["summary_specificity", "outcome_alignment", "evidence_strength"] },
  { profileId: "kaseki_output_review_v2", runId: RETRY_RUN_ID, answers: ["summary_specificity", "outcome_alignment", "evidence_strength", "recorded_outcome"] },
  { profileId: "run_retry_review_v1", runId: RETRY_RUN_ID, answers: ["recovery", "evidence_strength", "needs_followup"] },
] as const;

const harness = createTestHarness({
  root: process.cwd(),
  workers: [
    {
      configPath: "./test/soyuz-simulator/wrangler.jsonc",
      bindingOverrides: { SENKU: "senku" },
      secrets: {
        SOYUZ_SIMULATOR_USER_TOKEN: SOYUZ_USER_TOKEN,
        SENKU_SOYUZ_API_TOKEN: SOYUZ_MACHINE_TOKEN,
      },
    },
    {
      configPath: "./wrangler.jsonc",
      secrets: {
        OPENROUTER_API_KEY: OPENROUTER_KEY,
        SENKU_SOYUZ_API_TOKEN: SOYUZ_MACHINE_TOKEN,
        SENKU_KASEKI_API_TOKEN: KASEKI_MACHINE_TOKEN,
      },
    },
  ],
});

const providerRequests: DecisionRequest[] = [];
let providerCalls = 0;
let providerStatus: number | undefined;
let originalFetch: typeof fetch;

before(async () => {
  originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    if (request.url !== OPENROUTER_URL) {
      throw new Error("The Soyuz simulator test blocks every external request except the mocked OpenRouter call.");
    }
    providerCalls += 1;
    if (providerStatus !== undefined) return new Response("synthetic private provider detail", { status: providerStatus });
    const body = await request.clone().json() as DecisionRequest;
    providerRequests.push(body);
    return providerResponse(body, { usage: { input_tokens: 10, output_tokens: 5 } });
  };
  await harness.listen();
});

after(async () => {
  await harness.close();
  globalThis.fetch = originalFetch;
});

function dashboardRequest(profileId: string, runId: string, userToken = SOYUZ_USER_TOKEN): { url: string; init: RequestInit } {
  return {
    url: "https://soyuz.test/dashboard/api/analysis/decisions",
    init: {
      method: "POST",
      headers: {
        authorization: `Bearer ${userToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ profileId, runId }),
    },
  };
}

test("simulates Soyuz dashboard decisions over a real Senku Worker Service Binding", async () => {
  providerRequests.length = 0;
  providerCalls = 0;
  providerStatus = undefined;
  const soyuz = harness.getWorker("soyuz-simulator");

  for (const [index, scenario] of scenarios.entries()) {
    const input = dashboardRequest(scenario.profileId, scenario.runId);
    const response = await soyuz.fetch(input.url, input.init);
    const body = await response.json() as { data?: { model?: string; answers?: Record<string, unknown> } };
    assert.equal(response.status, 200, JSON.stringify(body));
    assert.deepEqual(Object.keys(body.data ?? {}).sort(), ["answers", "model"]);
    assert.equal(body.data?.model, "typesafe/jev-1.14-20261014");
    assert.deepEqual(Object.keys(body.data?.answers ?? {}).sort(), [...scenario.answers].sort());

    const providerRequest = providerRequests[index];
    assert.ok(providerRequest, `expected a provider call for ${scenario.profileId}`);
    assert.equal(providerRequest.model, "~typesafe/jev-latest");
    assert.equal(JSON.stringify(providerRequest).includes(TASK_MARKER), false, "raw task prompts stay inside Soyuz");

    const state = JSON.parse(String(providerRequest.state)) as Record<string, unknown>;
    if (scenario.profileId === "run_operations_triage_v1") {
      assert.deepEqual(Object.keys(state).sort(), ["run", "source"]);
      assert.equal((state.run as Record<string, unknown>).status, "failed");
      assert.deepEqual(Object.keys(state.run as Record<string, unknown>).sort(), [
        "completedAt", "createdAt", "failureClass", "lastHeartbeatAt", "operationalHealth",
        "queuedAt", "stage", "startedAt", "status",
      ]);
    } else if (scenario.profileId === "run_retry_review_v1") {
      assert.deepEqual(Object.keys(state).sort(), ["note", "retryComparison", "source"]);
      const comparison = state.retryComparison as Record<string, Record<string, unknown>>;
      assert.equal(comparison.source.status, "failed");
      assert.equal(comparison.retry.status, "completed");
      assert.deepEqual(Object.keys(comparison.source).sort(), [
        "changedFileCount", "exitCode", "failureClass", "status", "summary",
      ]);
    } else {
      assert.deepEqual(Object.keys(state).sort(), ["canonicalRun", "kasekiAgentOutput", "note", "source"]);
      assert.equal((state.canonicalRun as Record<string, unknown>).status, "completed");
      assert.equal(((state.kasekiAgentOutput as Record<string, unknown>).summary), "The retry passed validation.");
      if (scenario.profileId === "kaseki_output_review_v2") {
        assert.ok(providerRequest.questions?.recorded_outcome, "v2 adds the recorded outcome assessment");
      }
    }
  }

  assert.equal(providerCalls, scenarios.length, "each profile evaluation makes exactly one provider attempt");
  const logs = harness.getLogs();
  assert.equal(JSON.stringify(logs).includes(SOYUZ_MACHINE_TOKEN), false, "machine credentials stay out of Worker logs");
  assert.equal(JSON.stringify(logs).includes(TASK_MARKER), false, "raw task prompts stay out of Worker logs");
});

test("keeps Soyuz dashboard and Senku provider failures bounded and private", async () => {
  providerRequests.length = 0;
  providerCalls = 0;
  providerStatus = 503;
  const soyuz = harness.getWorker("soyuz-simulator");
  const input = dashboardRequest("run_operations_triage_v1", SOURCE_RUN_ID);
  const response = await soyuz.fetch(input.url, input.init);
  const body = await response.text();

  assert.equal(response.status, 502);
  assert.match(body, /JEV_PROVIDER_UNAVAILABLE/);
  assert.equal(body.includes("synthetic private provider detail"), false);
  assert.equal(body.includes(SOYUZ_MACHINE_TOKEN), false);
  assert.equal(providerCalls, 1, "a failed provider response still consumes one provider attempt");
  providerStatus = undefined;
});

test("rejects unauthorized and unsupported Soyuz dashboard requests before inference", async () => {
  providerRequests.length = 0;
  providerCalls = 0;
  providerStatus = undefined;
  const soyuz = harness.getWorker("soyuz-simulator");

  const unauthorizedRequest = dashboardRequest("run_operations_triage_v1", SOURCE_RUN_ID, "wrong-user-token");
  const unauthorized = await soyuz.fetch(unauthorizedRequest.url, unauthorizedRequest.init);
  assert.equal(unauthorized.status, 401);

  const unsupportedRequest = dashboardRequest("task_admission_v1", SOURCE_RUN_ID);
  const unsupportedProfile = await soyuz.fetch(unsupportedRequest.url, unsupportedRequest.init);
  assert.equal(unsupportedProfile.status, 400);

  const missingRunRequest = dashboardRequest("run_operations_triage_v1", "33333333-3333-4333-8333-333333333333");
  const missingRun = await soyuz.fetch(missingRunRequest.url, missingRunRequest.init);
  assert.equal(missingRun.status, 404);
  assert.equal(providerCalls, 0);
});
