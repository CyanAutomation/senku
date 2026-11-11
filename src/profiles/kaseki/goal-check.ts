import type { DecisionAnswer, DecisionQuestion } from "../../contracts/decisions";
import type { DecisionProfile, JsonSchema } from "../../contracts/profiles";
import { ProfileEngineError } from "../../contracts/profiles";
import { profileOwner } from "../../auth/permissions";
import { jsonState, redactKasekiEvidence, requireBoundedJsonObject, requireOnlyKeys, requireRecord, requireString, validateAnswersForQuestions } from "../validation";
import { buildGoalCheckQuestions, type GoalCheckCriterion } from "./workflow-questions";

const PROFILE_ID = "kaseki_goal_check_v1" as const;
const MAX_CRITERIA = 32;
const MAX_STATE_BYTES = 48 * 1024;

export interface KasekiGoalCheckInput {
  state: Record<string, unknown>;
  criteria: GoalCheckCriterion[];
}

const inputSchema: JsonSchema = {
  type: "object",
  required: ["state", "criteria"],
  additionalProperties: false,
  properties: {
    state: { type: "object", additionalProperties: true },
    criteria: {
      type: "array", minItems: 1, maxItems: MAX_CRITERIA,
      items: {
        type: "object", required: ["id", "criterion"], additionalProperties: false,
        properties: {
          id: { type: "string", pattern: "^criterion_[1-9][0-9]*$", maxLength: 32 },
          criterion: { type: "string", minLength: 1, maxLength: 4_096 },
          appliesWhen: { type: "string", minLength: 1, maxLength: 2_048 },
          sourceRequirement: { type: "string", minLength: 1, maxLength: 2_048 },
          verificationSources: { type: "array", maxItems: 16, items: { type: "string", minLength: 1, maxLength: 512 } },
        },
      },
    },
  },
};

function validateInput(value: unknown): KasekiGoalCheckInput {
  const root = requireRecord(value);
  requireOnlyKeys(root, ["state", "criteria"], ["state", "criteria"]);
  const state = requireBoundedJsonObject(root.state, MAX_STATE_BYTES);
  if (!Array.isArray(root.criteria) || root.criteria.length < 1 || root.criteria.length > MAX_CRITERIA) {
    throw new ProfileEngineError("INVALID_PROFILE_INPUT");
  }
  const ids = new Set<string>();
  const criteria = root.criteria.map((value) => {
    const item = requireRecord(value);
    requireOnlyKeys(item, ["id", "criterion", "appliesWhen", "sourceRequirement", "verificationSources"], ["id", "criterion"]);
    const id = requireString(item.id, 32);
    if (!/^criterion_[1-9][0-9]*$/.test(id) || ids.has(id)) throw new ProfileEngineError("INVALID_PROFILE_INPUT");
    ids.add(id);
    const criterion = requireString(item.criterion, 4_096);
    const appliesWhen = item.appliesWhen === undefined ? undefined : requireString(item.appliesWhen, 2_048);
    const sourceRequirement = item.sourceRequirement === undefined ? undefined : requireString(item.sourceRequirement, 2_048);
    let verificationSources: string[] | undefined;
    if (item.verificationSources !== undefined) {
      if (!Array.isArray(item.verificationSources) || item.verificationSources.length > 16) {
        throw new ProfileEngineError("INVALID_PROFILE_INPUT");
      }
      verificationSources = item.verificationSources.map((source) => requireString(source, 512));
    }
    return {
      id, criterion,
      ...(appliesWhen ? { appliesWhen } : {}),
      ...(sourceRequirement ? { sourceRequirement } : {}),
      ...(verificationSources?.length ? { verificationSources } : {}),
    };
  });
  const questionCount = criteria.reduce((count, criterion) => count + (criterion.appliesWhen ? 2 : 1), 0);
  if (questionCount > 64) throw new ProfileEngineError("INVALID_PROFILE_INPUT");
  return { state, criteria };
}

export const kasekiGoalCheckProfile: DecisionProfile<
  typeof PROFILE_ID,
  "kaseki",
  KasekiGoalCheckInput,
  Record<string, DecisionQuestion>,
  Record<string, DecisionAnswer>
> = {
  id: PROFILE_ID,
  name: "Kaseki goal check",
  description: "Assess bounded run evidence against caller-provided goal criteria; the criteria are data and local outcome policy remains authoritative.",
  owner: profileOwner(PROFILE_ID),
  version: "1",
  maxEvidenceBytes: MAX_STATE_BYTES,
  dynamicQuestions: true,
  maxQuestionCount: 64,
  answerIdPattern: "^criterion_[1-9][0-9]*(?:_applicability)?$",
  questions: {},
  inputSchema,
  validateInput,
  buildDecision(input) {
    return {
      state: jsonState({ source: "untrusted_kaseki_goal_check_evidence", evidence: redactKasekiEvidence(input.state) }),
      questions: buildGoalCheckQuestions(input.criteria),
    };
  },
  validateOutput(answers, input) {
    return validateAnswersForQuestions(answers, buildGoalCheckQuestions(input.criteria)) as Record<string, DecisionAnswer>;
  },
};
