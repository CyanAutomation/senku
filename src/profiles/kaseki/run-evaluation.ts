import type { DecisionAnswer, DecisionQuestion } from "../../contracts/decisions";
import type { DecisionProfile, JsonSchema } from "../../contracts/profiles";
import { ProfileEngineError } from "../../contracts/profiles";
import { profileOwner } from "../../auth/permissions";
import { jsonState, redactKasekiEvidence, requireBoundedJsonObject, requireOnlyKeys, requireRecord, validateAnswersForQuestions } from "../validation";
import { buildRunEvaluationQuestions } from "./workflow-questions";

const PROFILE_ID = "kaseki_run_evaluation_v1" as const;
const MAX_STATE_BYTES = 96 * 1024;

export interface KasekiRunEvaluationInput {
  state: Record<string, unknown>;
  includeFailureDiagnosis: boolean;
}

const inputSchema: JsonSchema = {
  type: "object",
  required: ["state", "includeFailureDiagnosis"],
  additionalProperties: false,
  properties: {
    state: { type: "object", additionalProperties: true },
    includeFailureDiagnosis: { type: "boolean" },
  },
};

function validateInput(value: unknown): KasekiRunEvaluationInput {
  const root = requireRecord(value);
  requireOnlyKeys(root, ["state", "includeFailureDiagnosis"], ["state", "includeFailureDiagnosis"]);
  if (typeof root.includeFailureDiagnosis !== "boolean") {
    throw new ProfileEngineError("INVALID_PROFILE_INPUT");
  }
  return {
    state: requireBoundedJsonObject(root.state, MAX_STATE_BYTES),
    includeFailureDiagnosis: root.includeFailureDiagnosis,
  };
}

export const kasekiRunEvaluationProfile: DecisionProfile<
  typeof PROFILE_ID,
  "kaseki",
  KasekiRunEvaluationInput,
  Record<string, DecisionQuestion>,
  Record<string, DecisionAnswer>
> = {
  id: PROFILE_ID,
  name: "Kaseki run evaluation",
  description: "Score bounded coding-run evidence and provide an advisory failure diagnosis when requested.",
  owner: profileOwner(PROFILE_ID),
  version: "1",
  maxEvidenceBytes: MAX_STATE_BYTES,
  dynamicQuestions: true,
  maxQuestionCount: 5,
  answerIdPattern: "^(?:overall_assessment|reviewer_confidence|task_completion_score|validation_failure_cause|validation_recovery_action)$",
  questions: {},
  inputSchema,
  validateInput,
  buildDecision(input) {
    return {
      state: jsonState({ source: "untrusted_kaseki_run_evaluation_evidence", evidence: redactKasekiEvidence(input.state) }),
      questions: buildRunEvaluationQuestions(input.includeFailureDiagnosis),
    };
  },
  validateOutput(answers, input) {
    return validateAnswersForQuestions(answers, buildRunEvaluationQuestions(input.includeFailureDiagnosis)) as Record<string, DecisionAnswer>;
  },
};
