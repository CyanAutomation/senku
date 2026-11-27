import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createTestHarness } from "wrangler";
import type { DecisionRequest } from "../src/contracts/decisions.ts";
import { providerResponse } from "../test/helpers/provider-response.ts";
import { createOpenRouterSimulator, type OpenRouterScenario } from "../test/helpers/openrouter-simulator.ts";
import soyuzSimulatorWorker from "../test/soyuz-simulator/worker.ts";

const SOYUZ_USER_TOKEN = "soyuz-simulator-user-token-0000000000000000";
const SOYUZ_MACHINE_TOKEN = "soyuz-simulator-machine-token-0000000000000000";
const KASEKI_MACHINE_TOKEN = "kaseki-simulator-machine-token-0000000000000000";
const PROVIDER_AUTHORIZATION = "TestCredential synthetic-provider-value";
const TASK_MARKER = "SYNTHETIC_SOYUZ_TASK_PROMPT_MUST_STAY_IN_SOYUZ";
const SOURCE_RUN_ID = "11111111-1111-4111-8111-111111111111";
const RETRY_RUN_ID = "22222222-2222-4222-8222-222222222222";
const INVALID_EXIT_CODE_RUN_ID = "44444444-4444-4444-8444-444444444444";

interface SimulatedProviderRequest {
  model: string;
  state: unknown;
  questions?: DecisionRequest["questions"];
}

const scenarios = [
  { profileId: "run_operations_triage_v1", runId: SOURCE_RUN_ID, answers: ["needs_followup", "likely_area", "severity"] },
  { profileId: "kaseki_output_review_v1", runId: RETRY_RUN_ID, answers: ["summary_specificity", "outcome_alignment", "evidence_strength"] },
  { profileId: "kaseki_output_review_v2", runId: RETRY_RUN_ID, answers: ["summary_specificity", "outcome_alignment", "evidence_strength", "recorded_outcome"] },
  { profileId: "kaseki_output_review_v2", runId: INVALID_EXIT_CODE_RUN_ID, answers: ["summary_specificity", "outcome_alignment", "evidence_strength", "recorded_outcome"] },
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
        SENKU_PROVIDER_REQUEST_URL: "https://provider.example.invalid/api/v1/decisions",
        SENKU_PROVIDER_AUTHORIZATION: PROVIDER_AUTHORIZATION,
        SENKU_SOYUZ_API_TOKEN: SOYUZ_MACHINE_TOKEN,
        SENKU_KASEKI_API_TOKEN: KASEKI_MACHINE_TOKEN,
      },
    },
  ],
});

const openRouter = createOpenRouterSimulator();
let originalFetch: typeof fetch;

function successfulProviderScenario(): OpenRouterScenario {
  return {
    kind: "response",
    body: async (requestBody) => {
      const response = providerResponse(requestBody as DecisionRequest, { usage: { input_tokens: 10, output_tokens: 5 } });
      return response.text();
    },
  };
}

before(async () => {
  originalFetch = globalThis.fetch;
  globalThis.fetch = openRouter.fetch;
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
  openRouter.reset(...scenarios.map(() => successfulProviderScenario()));
  const soyuz = harness.getWorker("soyuz-simulator");

  for (const [index, scenario] of scenarios.entries()) {
    const input = dashboardRequest(scenario.profileId, scenario.runId);
    const response = await soyuz.fetch(input.url, input.init);
    const body = await response.json() as { data?: { model?: string; answers?: Record<string, unknown> } };
    assert.equal(response.status, 200, `${scenario.profileId}: ${JSON.stringify(body)}`);
    assert.deepEqual(Object.keys(body.data ?? {}).sort(), ["answers", "model"]);
    assert.equal(body.data?.model, "typesafe/jev-1.14-20261014");
    assert.deepEqual(Object.keys(body.data?.answers ?? {}).sort(), [...scenario.answers].sort());

    const providerRequest = openRouter.requests[index]?.body as SimulatedProviderRequest | undefined;
    assert.ok(providerRequest, `expected a provider call for ${scenario.profileId}`);
    assert.equal(providerRequest.model, "~typesafe/jev-latest");
    assert.equal(JSON.stringify(providerRequest).includes(TASK_MARKER), false, "raw task prompts stay inside Soyuz");

    const state = JSON.parse(String(providerRequest.state)) as Record<string, unknown>;
    if (scenario.profileId === "run_operations_triage_v1") {
      // Assert Senku's provider-facing projection, which adds its own source marker to the Soyuz input.
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
      const expectedSummary = scenario.runId === INVALID_EXIT_CODE_RUN_ID
        ? "The exit code is malformed in this retained record."
        : "The retry passed validation.";
      assert.equal((state.kasekiAgentOutput as Record<string, unknown>).summary, expectedSummary);
      if (scenario.runId === INVALID_EXIT_CODE_RUN_ID) {
        assert.equal((state.canonicalRun as Record<string, unknown>).exitCode, null);
      }
      if (scenario.profileId === "kaseki_output_review_v2") {
        assert.ok(providerRequest.questions?.recorded_outcome, "v2 adds the recorded outcome assessment");
      }
    }
  }

  assert.equal(openRouter.callCount, scenarios.length, "each profile evaluation makes exactly one provider attempt");
  assert.equal(openRouter.pendingScenarioCount, 0);
  const logs = harness.getLogs();
  assert.equal(JSON.stringify(logs).includes(SOYUZ_MACHINE_TOKEN), false, "machine credentials stay out of Worker logs");
  assert.equal(JSON.stringify(logs).includes(TASK_MARKER), false, "raw task prompts stay out of Worker logs");
});

test("rejects the literal undefined bearer value when the dashboard token is absent", async () => {
  openRouter.reset();
  const response = await soyuzSimulatorWorker.fetch(
    new Request("https://soyuz.test/dashboard/api/analysis/decisions", {
      method: "POST",
      headers: { authorization: "Bearer undefined", "content-type": "application/json" },
      body: JSON.stringify({ profileId: "run_operations_triage_v1", runId: SOURCE_RUN_ID }),
    }),
    {
      SENKU: { fetch: async () => { throw new Error("unauthorized request reached Senku"); } },
      SENKU_SOYUZ_API_TOKEN: SOYUZ_MACHINE_TOKEN,
    },
  );

  assert.equal(response.status, 401);
  assert.match(await response.text(), /UNAUTHENTICATED/);
});

test("keeps Soyuz dashboard and Senku provider failures bounded and private", async () => {
  openRouter.reset({
    kind: "response",
    status: 503,
    body: "synthetic private provider detail",
  });
  const soyuz = harness.getWorker("soyuz-simulator");
  const input = dashboardRequest("run_operations_triage_v1", SOURCE_RUN_ID);
  const response = await soyuz.fetch(input.url, input.init);
  const body = await response.text();

  assert.equal(response.status, 502);
  assert.match(body, /JEV_PROVIDER_UNAVAILABLE/);
  assert.equal(body.includes("synthetic private provider detail"), false);
  assert.equal(body.includes(SOYUZ_MACHINE_TOKEN), false);
  assert.equal(openRouter.callCount, 1, "a failed provider response still consumes one provider attempt");
  assert.equal(openRouter.pendingScenarioCount, 0);
  assert.equal(JSON.stringify(harness.getLogs()).includes("synthetic private provider detail"), false);

  openRouter.enqueue(successfulProviderScenario());
  const recovered = await soyuz.fetch(input.url, input.init);
  const recoveredBody = await recovered.json() as { data?: { answers?: Record<string, unknown> } };
  assert.equal(recovered.status, 200, "a new evaluation succeeds after the provider recovers");
  assert.ok(recoveredBody.data?.answers);
  assert.equal(openRouter.callCount, 2, "recovery is a caller initiated request, not a hidden provider retry");
  assert.equal(openRouter.pendingScenarioCount, 0);
});

test("rejects unauthorized and unsupported Soyuz dashboard requests before inference", async () => {
  openRouter.reset();
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
  assert.equal(openRouter.callCount, 0);
});
