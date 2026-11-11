import { describe, expect, it, vi } from "vitest";
import { PROFILE_CLIENT_PERMISSIONS } from "../src/auth/permissions";
import { ProfileEngineError, type ProfileQuestions } from "../src/contracts/profiles";
import { type DecisionAnswer, type DecisionRequest, type Environment } from "../src/contracts/decisions";
import { evaluateProfile } from "../src/decisions/profile-engine";
import { profileRegistry } from "../src/decisions/profile-registry";
import { ProviderError } from "../src/providers/openrouter/decisions";
import { taskAdmissionProfile } from "../src/profiles/kaseki/task-admission";
import { validationRecoveryProfile } from "../src/profiles/kaseki/validation-recovery";
import { runOperationsTriageProfile } from "../src/profiles/soyuz/run-operations-triage";
import { kasekiOutputReviewV1Profile } from "../src/profiles/soyuz/output-review-v1";
import { kasekiOutputReviewV2Profile } from "../src/profiles/soyuz/output-review-v2";
import { kasekiGoalCheckProfile } from "../src/profiles/kaseki/goal-check";
import { kasekiRunEvaluationProfile } from "../src/profiles/kaseki/run-evaluation";
import { kasekiContextRoutingProfile } from "../src/profiles/kaseki/context-routing";

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

const goalCheckInput = {
  state: { diff: "updated src/worker.ts", validation: "npm test passed" },
  criteria: [
    { id: "criterion_1", criterion: "The worker handles cancellation.", verificationSources: ["validation.log"] },
    { id: "criterion_2", criterion: "The change does not expose credentials.", appliesWhen: "credentials are used" },
  ],
};

const runEvaluationInput = {
  state: { validation: "npm test passed", diff: "updated src/worker.ts" },
  includeFailureDiagnosis: false,
};

const contextRoutingInput = {
  mode: "phase_transfer",
  evidence: {
    phase_from: "scouting", phase_to: "coding", goal_summary: "Share the common helper.",
    candidates: [{ id: "file_0", kind: "inspected_file", path: "src/shared.ts", text: "Reusable helper candidate." }],
  },
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

function validatedAnswerFor(question: ProfileQuestions[string]): DecisionAnswer {
  const answer = answerFor(question);
  if (question.type === "noul") {
    const noul = answer.noul as number;
    return { type: "noul", noul, probabilities: { false: 1 - noul, true: noul }, confidence: null };
  }
  return answer as unknown as DecisionAnswer;
}

function responseFor(request: DecisionRequest): Response {
  return new Response(JSON.stringify({
    model: "typesafe/jev-1.14-20261014",
    answers: Object.fromEntries(Object.entries(request.questions).map(([key, question]) => [key, answerFor(question)])),
    usage: { input_tokens: 120, output_tokens: 24, cost: 0.0001 },
  }), { headers: { "content-type": "application/json" } });
}

function rawAnswers(questions: ProfileQuestions): Record<string, DecisionAnswer> {
  return Object.fromEntries(Object.entries(questions).map(([key, question]) => [key, validatedAnswerFor(question)]));
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
      "kaseki_goal_check_v1",
      "kaseki_run_evaluation_v1",
      "kaseki_context_routing_v1",
      "validation_recovery_v1",
    ]);
    expect(profiles.map((profile) => profile.version)).toEqual(["1", "1", "2", "1", "1", "1", "1", "1"]);
    expect(profiles.map((profile) => profile.questionCount)).toEqual([3, 3, 4, 6, 64, 5, 32, 2]);
    expect(profiles.map((profile) => profile.dynamicQuestions)).toEqual([false, false, false, false, true, true, true, false]);
    expect(profiles[0]).toMatchObject({ owner: "soyuz", allowedClients: ["soyuz"], maxEvidenceBytes: 12 * 1024 });
    expect(profiles[3]).toMatchObject({ owner: "kaseki", allowedClients: ["kaseki"] });
    expect(PROFILE_CLIENT_PERMISSIONS.validation_recovery_v1).toEqual(["kaseki"]);
    expect(PROFILE_CLIENT_PERMISSIONS.kaseki_goal_check_v1).toEqual(["kaseki"]);
    expect(PROFILE_CLIENT_PERMISSIONS.kaseki_run_evaluation_v1).toEqual(["kaseki"]);
    expect(PROFILE_CLIENT_PERMISSIONS.kaseki_context_routing_v1).toEqual(["kaseki"]);
    for (const profile of profiles) {
      const permissions = PROFILE_CLIENT_PERMISSIONS[profile.id as keyof typeof PROFILE_CLIENT_PERMISSIONS];
      expect(profile.allowedClients).toEqual(permissions);
      expect(permissions).toContain(profile.owner);
      expect(profile.id).toBe(profileRegistry.getProfile(profile.id).id);
    }
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

  it("builds bounded goal-check questions from validated criteria and validates their exact answers", () => {
    const input = kasekiGoalCheckProfile.validateInput(goalCheckInput);
    const decision = kasekiGoalCheckProfile.buildDecision(input);
    expect(Object.keys(decision.questions)).toEqual([
      "criterion_1", "criterion_2_applicability", "criterion_2",
    ]);
    expect(decision.questions.criterion_1).toMatchObject({ type: "noul" });
    expect(decision.questions.criterion_2_applicability).toMatchObject({
      type: "choice", criteria: { applicable: expect.any(String), not_applicable: expect.any(String), unknown: expect.any(String) },
    });
    expect(() => kasekiGoalCheckProfile.validateInput({ ...goalCheckInput, questions: {} })).toThrow(ProfileEngineError);
    expect(() => kasekiGoalCheckProfile.validateInput({
      ...goalCheckInput,
      criteria: Array.from({ length: 33 }, (_item, index) => ({ id: `criterion_${index + 1}`, criterion: "A criterion." })),
    })).toThrow(ProfileEngineError);

    const answers = rawAnswers(decision.questions as ProfileQuestions);
    expect(Object.keys(kasekiGoalCheckProfile.validateOutput(answers, input))).toEqual(Object.keys(decision.questions));
    expect(() => kasekiGoalCheckProfile.validateOutput({ ...answers, unexpected: answers.criterion_1 }, input)).toThrow(ProfileEngineError);
  });

  it("builds a fixed run-evaluation contract with optional failure diagnosis", () => {
    const regular = kasekiRunEvaluationProfile.buildDecision(kasekiRunEvaluationProfile.validateInput(runEvaluationInput));
    const failure = kasekiRunEvaluationProfile.buildDecision(kasekiRunEvaluationProfile.validateInput({
      ...runEvaluationInput, includeFailureDiagnosis: true,
    }));
    expect(Object.keys(regular.questions)).toEqual([
      "overall_assessment", "reviewer_confidence", "task_completion_score",
    ]);
    expect(Object.keys(failure.questions)).toEqual([
      "overall_assessment", "reviewer_confidence", "task_completion_score",
      "validation_failure_cause", "validation_recovery_action",
    ]);
    expect(() => kasekiRunEvaluationProfile.validateInput({ ...runEvaluationInput, extra: true })).toThrow(ProfileEngineError);
  });

  it("uses one server-owned context-routing profile for all three routing modes", () => {
    const phase = kasekiContextRoutingProfile.validateInput(contextRoutingInput);
    expect(Object.keys(kasekiContextRoutingProfile.buildDecision(phase).questions)).toEqual(["file_0"]);
    expect(() => kasekiContextRoutingProfile.validateOutput({ file_0: validatedAnswerFor({
      type: "choice", instructions: "", criteria: { preserve: null, condense: null, discard: null },
    }) }, phase)).not.toThrow();
    expect(() => kasekiContextRoutingProfile.validateInput({
      mode: "phase_transfer", evidence: { ...contextRoutingInput.evidence, candidates: [{ id: "unsafe_id", kind: "plan", text: "x" }] },
    })).toThrow(ProfileEngineError);
    expect(Object.keys(kasekiContextRoutingProfile.buildDecision(kasekiContextRoutingProfile.validateInput({
      mode: "tool_output", evidence: { phase: "coding", toolName: "bash", resultKind: "command_output", isError: false, characters: 1, bytes: 1, approximateTokens: 1, lineCount: 1, consecutiveDuplicateLineRatio: 0, hasReadRange: false },
    })).questions)).toEqual(["route"]);
    expect(Object.keys(kasekiContextRoutingProfile.buildDecision(kasekiContextRoutingProfile.validateInput({
      mode: "semantic_context", evidence: { phase: "coding", toolName: "bash", resultKind: "command_output", isError: false, characters: 1, bytes: 1, approximateTokens: 1, lineCount: 1, consecutiveDuplicateLineRatio: 0, hasReadRange: false, goalSummary: "bounded goal" },
    })).questions)).toEqual(["disposition"]);
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
    expect(kasekiOutputReviewV1Profile.validateInput({ ...outputReviewInput, canonicalRun: { ...outputReviewInput.canonicalRun, exitCode: -1 } }).canonicalRun.exitCode).toBe(-1);
    expect(() => kasekiOutputReviewV1Profile.validateInput({ ...outputReviewInput, canonicalRun: { ...outputReviewInput.canonicalRun, exitCode: -2 } })).toThrow();
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
    expect(validationRecoveryProfile.validateInput({ ...validationRecoveryInput, output: "x".repeat(6_000) }).output).toHaveLength(6_000);
    expect(() => validationRecoveryProfile.validateInput({ ...validationRecoveryInput, output: "x".repeat(6_001) })).toThrow();
    expect(validationRecoveryProfile.validateInput({ ...validationRecoveryInput, output: "é".repeat(3_000) }).output).toHaveLength(3_000);
    expect(() => validationRecoveryProfile.validateInput({ ...validationRecoveryInput, output: "é".repeat(3_001) })).toThrow();
  });

  it("redacts validation secrets before retaining the output tail, including a credential split by the old boundary", () => {
    const credential = `Bearer ${"A".repeat(64)}`;
    const retained = validationRecoveryProfile.buildDecision(validationRecoveryProfile.validateInput({
      command: "npm test",
      exitCode: 1,
      output: `prefix ${credential} suffix`,
    }));
    const retainedState = JSON.parse(retained.state as string) as { failure_output: string };
    expect(retainedState.failure_output).toContain("[REDACTED_CREDENTIAL]");
    expect(retainedState.failure_output).not.toContain("A".repeat(64));

    const crossingPrefix = "x".repeat(998) + " ";
    const crossingOutput = crossingPrefix + credential + "y".repeat(6_000 - crossingPrefix.length - credential.length);
    const crossing = validationRecoveryProfile.buildDecision(validationRecoveryProfile.validateInput({
      command: "npm test",
      exitCode: 1,
      output: crossingOutput,
    }));
    const crossingState = JSON.parse(crossing.state as string) as { failure_output: string };
    expect(crossingState.failure_output).toContain("[REDACTED_CREDENTIAL]");
    expect(crossingState.failure_output).not.toContain("A".repeat(64));
  });

  it("redacts common token and password patterns and preserves Unicode at a truncation boundary", () => {
    const sensitive = [
      "Authorization: Bearer " + "b".repeat(40),
      "AWS key AKIA" + "B".repeat(16),
      "JWT eyJ" + "c".repeat(24) + "." + "d".repeat(24) + "." + "e".repeat(24),
      "password=hunter2",
      "https://user:private-value@example.test/path",
    ].join(" ");
    const output = "z".repeat(4_000) + sensitive;
    const state = JSON.parse(validationRecoveryProfile.buildDecision(validationRecoveryProfile.validateInput({
      command: "Authorization: Bearer " + "f".repeat(40),
      exitCode: 1,
      output,
    })).state as string) as { command: string; failure_output: string };
    expect(state.command).not.toContain("f".repeat(40));
    expect(state.failure_output).not.toContain("b".repeat(40));
    expect(state.failure_output).not.toContain("AKIA" + "B".repeat(16));
    expect(state.failure_output).not.toContain("private-value");
    expect(state.failure_output).not.toContain("hunter2");

    const unicode = "x".repeat(99) + "😀" + "y".repeat(4_999);
    const unicodeState = JSON.parse(validationRecoveryProfile.buildDecision(validationRecoveryProfile.validateInput({
      command: "npm test", exitCode: 1, output: unicode,
    })).state as string) as { failure_output: string };
    expect(unicodeState.failure_output).not.toContain("\uFFFD");
    expect(() => JSON.stringify(unicodeState)).not.toThrow();
  });

  it("keeps the final redacted validation evidence inside the evidence byte limit", () => {
    const stateText = validationRecoveryProfile.buildDecision(validationRecoveryProfile.validateInput({
      command: "npm test",
      exitCode: 1,
      output: "\"".repeat(6_000),
    })).state as string;
    expect(new TextEncoder().encode(stateText).byteLength).toBeLessThanOrEqual(validationRecoveryProfile.maxEvidenceBytes);
    expect(JSON.parse(stateText).failure_output.length).toBeLessThan(5_000);
  });

  it("rejects missing, unexpected, wrong-type, and out-of-scale profile answers", () => {
    const admissionInput = taskAdmissionProfile.validateInput(taskAdmissionInput);
    expect(() => taskAdmissionProfile.validateOutput({}, admissionInput)).toThrow(ProfileEngineError);
    const unexpected = rawAnswers(taskAdmissionProfile.questions);
    unexpected.extra = { type: "noul", noul: 0.5, probabilities: { false: 0.5, true: 0.5 }, confidence: null };
    expect(() => taskAdmissionProfile.validateOutput(unexpected, admissionInput)).toThrow(ProfileEngineError);

    const wrongChoice = rawAnswers(taskAdmissionProfile.questions);
    wrongChoice.risk_level = { type: "choice", choice: "allowed?", probabilities: {}, confidence: null };
    expect(() => taskAdmissionProfile.validateOutput(wrongChoice, admissionInput)).toThrow(ProfileEngineError);

    const outOfScale = rawAnswers(kasekiOutputReviewV2Profile.questions);
    outOfScale.recorded_outcome = { type: "score", score: 4, probabilities: {}, legend: {}, confidence: null };
    expect(() => kasekiOutputReviewV2Profile.validateOutput(outOfScale, kasekiOutputReviewV2Profile.validateInput(outputReviewInput))).toThrow(ProfileEngineError);
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

  it("maps unexpected provider-call exceptions to retryable provider errors", async () => {
    const requestDecision = async () => {
      throw new Error("private provider runtime detail");
    };
    const error = await evaluateProfile(
      "validation_recovery_v1",
      validationRecoveryInput,
      { clientIdentity: "kaseki" },
      { env, requestDecision },
    ).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(ProviderError);
    expect(error).toMatchObject({ code: "PROVIDER_UNAVAILABLE", retryable: true });
    expect(String(error)).not.toContain("private provider runtime detail");
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
