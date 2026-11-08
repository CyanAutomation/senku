import { describe, expect, it, vi } from "vitest";
import { PROFILE_CLIENT_PERMISSIONS } from "../src/auth/permissions";
import { ProfileEngineError, type ProfileQuestions } from "../src/contracts/profiles";
import { type DecisionRequest, type Environment } from "../src/contracts/decisions";
import { evaluateProfile } from "../src/decisions/profile-engine";
import { profileRegistry } from "../src/decisions/profile-registry";
import { taskAdmissionProfile } from "../src/profiles/kaseki/task-admission";
import { validationRecoveryProfile } from "../src/profiles/kaseki/validation-recovery";
import { runOperationsTriageProfile } from "../src/profiles/soyuz/run-operations-triage";
import { kasekiOutputReviewV1Profile } from "../src/profiles/soyuz/output-review-v1";
import { kasekiOutputReviewV2Profile } from "../src/profiles/soyuz/output-review-v2";

const runTriageInput = {
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
};

const outputReviewInput = {
  canonicalRun: { status: "completed", failureClass: null, exitCode: 0, changedFileCount: 3 },
  summary: "Implemented the requested change and passed the declared checks.",
};

const taskAdmissionInput = {
  repoUrl: "https://github.com/CyanAutomation/senku",
  ref: "main",
  taskPrompt: "Update the API key handling; api_key=synthetic-secret-value",
  validationCommands: ["npm test"],
  changedFilesAllowlist: ["src/**"],
  taskMode: "patch",
  publishMode: "pr",
  startupCheck: false,
  scouting: { enabled: true, timeoutSeconds: 120 },
  goalSetting: { enabled: false },
};

const validationRecoveryInput = {
  command: "npm test",
  exitCode: 1,
  output: "Test suite failed with an assertion mismatch.",
};

function answerFor(question: ProfileQuestions[string]): Record<string, unknown> {
  if (question.type === "noul") return { type: "noul", noul: 0.75 };
  if (question.type === "choice") {
    const keys = Object.keys(question.criteria);
    return {
      type: "choice",
      choice: keys[0],
      probabilities: Object.fromEntries(keys.map((key, index) => [key, index === 0 ? 1 : 0])),
      confidence: 0.9,
    };
  }
  const labels = question.criteria.map((criterion) => typeof criterion === "string" ? criterion : JSON.stringify(criterion));
  return {
    type: "score",
    score: 1,
    legend: Object.fromEntries(labels.map((label, index) => [String(index), label])),
    probabilities: Object.fromEntries(labels.map((_label, index) => [String(index), index === 1 ? 1 : 0])),
    confidence: null,
  };
}

function responseFor(request: DecisionRequest): Response {
  return new Response(JSON.stringify({
    model: "typesafe/jev-1.14-20261014",
    answers: Object.fromEntries(Object.entries(request.questions).map(([key, question]) => [key, answerFor(question)])),
    usage: { input_tokens: 120, output_tokens: 24, cost: 0.0001 },
  }), { headers: { "content-type": "application/json" } });
}

function rawAnswers(questions: ProfileQuestions): Record<string, unknown> {
  return Object.fromEntries(Object.entries(questions).map(([key, question]) => [key, answerFor(question)]));
}

const env: Environment = {
  OPENROUTER_API_KEY: "test-openrouter-key",
  JEV_MODEL: "~typesafe/jev-latest",
  SENKU_PROVIDER_TIMEOUT_MS: "15000",
};

describe("versioned decision profile registry", () => {
  it("registers exactly the initial Soyuz and Kaseki profiles with owner-scoped metadata", () => {
    const profiles = profileRegistry.listProfiles();
    expect(profiles.map((profile) => profile.id)).toEqual([
      "run_operations_triage_v1",
      "kaseki_output_review_v1",
      "kaseki_output_review_v2",
      "task_admission_v1",
      "validation_recovery_v1",
    ]);
    expect(profiles.map((profile) => profile.version)).toEqual(["1", "1", "2", "1", "1"]);
    expect(profiles.map((profile) => profile.questionCount)).toEqual([3, 3, 4, 6, 2]);
    expect(profiles[0]).toMatchObject({ owner: "soyuz", allowedClients: ["soyuz"], maxEvidenceBytes: 12 * 1024 });
    expect(profiles[3]).toMatchObject({ owner: "kaseki", allowedClients: ["kaseki"] });
    expect(PROFILE_CLIENT_PERMISSIONS.validation_recovery_v1).toEqual(["kaseki"]);
  });

  it("retains exact Soyuz question IDs, labels, and score scales", () => {
    expect(Object.keys(runOperationsTriageProfile.questions)).toEqual(["needs_followup", "likely_area", "severity"]);
    expect(Object.keys(runOperationsTriageProfile.questions.likely_area.criteria)).toEqual(["execution", "control_plane", "unknown"]);
    expect(runOperationsTriageProfile.questions.severity.criteria).toEqual(["Routine", "Needs review", "Urgent"]);

    expect(Object.keys(kasekiOutputReviewV1Profile.questions)).toEqual(["summary_specificity", "outcome_alignment", "evidence_strength"]);
    expect(Object.keys(kasekiOutputReviewV1Profile.questions.outcome_alignment.criteria)).toEqual(["consistent", "unclear", "inconsistent"]);
    expect(kasekiOutputReviewV1Profile.questions.evidence_strength.criteria).toEqual(["Insufficient", "Some concrete detail", "Clear and specific"]);

    expect(Object.keys(kasekiOutputReviewV2Profile.questions)).toEqual([
      "summary_specificity", "outcome_alignment", "evidence_strength", "recorded_outcome",
    ]);
    expect(kasekiOutputReviewV2Profile.questions.recorded_outcome.criteria).toEqual([
      "Outcome unclear or unsuccessful", "Partial or limited outcome evidence", "Successful and clearly reported outcome",
    ]);
  });

  it("retains Kaseki builder question keys and classifications", () => {
    expect(Object.keys(taskAdmissionProfile.questions)).toEqual([
      "contains_credentials", "changes_permissions", "crosses_security_boundary", "risk_level", "task_type", "validation_focus",
    ]);
    expect(Object.keys(taskAdmissionProfile.questions.risk_level.criteria)).toEqual(["low", "review", "high"]);
    expect(Object.keys(taskAdmissionProfile.questions.task_type.criteria)).toEqual([
      "feature", "bug_fix", "refactor", "documentation", "investigation", "test_only", "infrastructure",
    ]);
    expect(Object.keys(taskAdmissionProfile.questions.validation_focus.criteria)).toEqual([
      "unit_tests", "integration_tests", "type_and_lint", "docs_checks", "repo_defined_checks",
    ]);

    expect(Object.keys(validationRecoveryProfile.questions)).toEqual([
      "validation_failure_cause", "validation_recovery_action",
    ]);
    expect(Object.keys(validationRecoveryProfile.questions.validation_failure_cause.criteria)).toEqual([
      "test_failure", "type_or_lint_failure", "build_failure", "dependency_or_environment", "timeout_or_flaky", "implementation_logic", "unknown",
    ]);
    expect(Object.keys(validationRecoveryProfile.questions.validation_recovery_action.criteria)).toEqual([
      "fix_implementation", "repair_environment", "retry_validation_once", "inspect_diagnostics",
    ]);
  });
});

describe("profile evidence validation and projection", () => {
  it("builds the same bounded Soyuz operational projection without accepting extra fields", () => {
    const input = runOperationsTriageProfile.validateInput(runTriageInput);
    const decision = runOperationsTriageProfile.buildDecision(input);
    expect(JSON.parse(decision.state as string)).toEqual({
      source: "soyuz_run_operational_metadata",
      run: runTriageInput.run,
    });
    expect(() => runOperationsTriageProfile.validateInput({ ...runTriageInput, runId: "not-accepted" })).toThrow();
    expect(() => runOperationsTriageProfile.validateInput({ run: { ...runTriageInput.run, status: "invented" } })).toThrow();
    expect(() => runOperationsTriageProfile.validateInput({ run: { ...runTriageInput.run, createdAt: "not-a-date" } })).toThrow();
  });

  it("keeps Soyuz output review restricted to the summary and canonical run fields", () => {
    const input = kasekiOutputReviewV1Profile.validateInput(outputReviewInput);
    const v1 = JSON.parse(kasekiOutputReviewV1Profile.buildDecision(input).state as string);
    const v2 = JSON.parse(kasekiOutputReviewV2Profile.buildDecision(input).state as string);
    expect(v1).toMatchObject({
      source: "untrusted_kaseki_agent_result_summary",
      canonicalRun: outputReviewInput.canonicalRun,
      kasekiAgentOutput: { summary: outputReviewInput.summary },
    });
    expect(v2).toEqual(v1);
    expect(() => kasekiOutputReviewV1Profile.validateInput({ ...outputReviewInput, sourceCode: "do not send" })).toThrow();
    expect(() => kasekiOutputReviewV1Profile.validateInput({ ...outputReviewInput, summary: "x".repeat(2_001) })).toThrow();
    expect(() => kasekiOutputReviewV1Profile.validateInput({ ...outputReviewInput, canonicalRun: { ...outputReviewInput.canonicalRun, exitCode: 256 } })).toThrow();
  });

  it("keeps task admission advisory and projects only the Kaseki request fields", () => {
    const input = taskAdmissionProfile.validateInput(taskAdmissionInput);
    const decision = taskAdmissionProfile.buildDecision(input);
    const state = JSON.parse(decision.state as string) as Record<string, unknown>;
    expect(Object.keys(state)).toEqual([
      "repoUrl", "ref", "taskPrompt", "validationCommands", "changedFilesAllowlist", "taskMode", "publishMode", "startupCheck", "scouting", "goalSetting",
    ]);
    expect(state.taskPrompt).toContain("[REDACTED_SECRET]");
    expect(decision.questions).toBe(taskAdmissionProfile.questions);
    expect(() => taskAdmissionProfile.validateInput({ ...taskAdmissionInput, model: "other/model" })).toThrow();
    expect(() => taskAdmissionProfile.validateInput({ ...taskAdmissionInput, taskMode: "full-rewrite" })).toThrow();
    expect(() => taskAdmissionProfile.validateInput({ ...taskAdmissionInput, publishMode: "unsafe" })).toThrow();
    expect(() => taskAdmissionProfile.validateInput({ ...taskAdmissionInput, repoUrl: "https://user:secret@example.test/repo" })).toThrow();
  });

  it("bounds validation-recovery evidence and exposes no retry policy decision", () => {
    const input = validationRecoveryProfile.validateInput(validationRecoveryInput);
    const state = JSON.parse(validationRecoveryProfile.buildDecision(input).state as string) as Record<string, unknown>;
    expect(state).toEqual({
      command: "npm test",
      exit_code: 1,
      failure_output: "Test suite failed with an assertion mismatch.",
    });
    expect(Object.keys(state)).not.toContain("retry_authorized");
    expect(() => validationRecoveryProfile.validateInput({ ...validationRecoveryInput, retry: true })).toThrow();
    expect(() => validationRecoveryProfile.validateInput({ ...validationRecoveryInput, output: "x".repeat(6_001) })).toThrow();
  });

  it("rejects missing, unexpected, wrong-type, and out-of-scale profile answers", () => {
    expect(() => taskAdmissionProfile.validateOutput({})).toThrow(ProfileEngineError);
    const unexpected = rawAnswers(taskAdmissionProfile.questions);
    unexpected.extra = { type: "noul", noul: 0.5 };
    expect(() => taskAdmissionProfile.validateOutput(unexpected as never)).toThrow(ProfileEngineError);

    const wrongChoice = rawAnswers(taskAdmissionProfile.questions);
    wrongChoice.risk_level = { type: "choice", choice: "allowed?", probabilities: {}, confidence: null };
    expect(() => taskAdmissionProfile.validateOutput(wrongChoice as never)).toThrow(ProfileEngineError);

    const outOfScale = rawAnswers(kasekiOutputReviewV2Profile.questions);
    outOfScale.recorded_outcome = { type: "score", score: 4, probabilities: {}, legend: {}, confidence: null };
    expect(() => kasekiOutputReviewV2Profile.validateOutput(outOfScale as never)).toThrow(ProfileEngineError);
  });
});

describe("shared profile engine", () => {
  it("checks permissions before provider invocation and returns typed answers with safe usage metadata", async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => responseFor(JSON.parse(String(init?.body)) as DecisionRequest));
    const result = await evaluateProfile("task_admission_v1", taskAdmissionInput, { clientIdentity: "kaseki" }, { env, fetchImpl });
    expect(result.profileId).toBe("task_admission_v1");
    expect(result.profileVersion).toBe("1");
    expect(result.result.risk_level.choice).toBe("low");
    expect(result.metadata).toMatchObject({
      clientIdentity: "kaseki",
      resolvedModel: "typesafe/jev-1.14-20261014",
      questionCount: 6,
      attemptCount: 1,
      usage: { input_tokens: 120, output_tokens: 24, cost: 0.0001 },
    });
    expect(result.metadata.evidenceBytes).toBeGreaterThan(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body));
    expect(payload.model).toBe("~typesafe/jev-latest");

    await expect(evaluateProfile("task_admission_v1", taskAdmissionInput, { clientIdentity: "soyuz" }, { env, fetchImpl }))
      .rejects.toMatchObject({ code: "FORBIDDEN_PROFILE" });
    await expect(evaluateProfile("run_operations_triage_v1", runTriageInput, { clientIdentity: "kaseki" }, { env, fetchImpl }))
      .rejects.toMatchObject({ code: "FORBIDDEN_PROFILE" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("fails with a typed provider error and never returns a successful advisory result", async () => {
    const fetchImpl = vi.fn(async () => new Response("private provider detail", { status: 503 }));
    await expect(evaluateProfile("validation_recovery_v1", validationRecoveryInput, { clientIdentity: "kaseki" }, { env, fetchImpl }))
      .rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("rejects profile evidence beyond its stricter cap before provider invocation", async () => {
    const fetchImpl = vi.fn(async () => new Response("should not be called"));
    await expect(evaluateProfile("kaseki_output_review_v1", {
      canonicalRun: outputReviewInput.canonicalRun,
      summary: "x".repeat(2_001),
    }, { clientIdentity: "soyuz" }, { env, fetchImpl })).rejects.toMatchObject({ code: "INVALID_PROFILE_INPUT" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
