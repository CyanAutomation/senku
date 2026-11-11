import type { DecisionAnswer, DecisionQuestion } from "../../contracts/decisions";
import type { DecisionProfile, JsonSchema } from "../../contracts/profiles";
import { ProfileEngineError } from "../../contracts/profiles";
import { profileOwner } from "../../auth/permissions";
import { jsonState, redactKasekiEvidence, requireBoundedJsonObject, requireEnum, requireOnlyKeys, requireRecord, requireString, validateAnswersForQuestions } from "../validation";

const PROFILE_ID = "kaseki_context_routing_v1" as const;
const MAX_CANDIDATES = 32;
const MAX_EVIDENCE_BYTES = 32 * 1024;
const ROUTES = {
  preserve: "Keep the original evidence intact when it may matter to the task or uncertainty remains.",
  condense: "Keep useful evidence at lower fidelity; deterministic local code performs the transformation.",
  discard: "Omit only clearly irrelevant or redundant evidence that is safe to leave out of active context.",
} as const;
const PHASE_CANDIDATE_ID = /^(?:file|observation|plan|test)_[0-9]+$/;

export type ContextRoutingMode = "tool_output" | "semantic_context" | "phase_transfer";
export interface KasekiContextRoutingInput {
  mode: ContextRoutingMode;
  evidence: Record<string, unknown>;
}

const inputSchema: JsonSchema = {
  type: "object", required: ["mode", "evidence"], additionalProperties: false,
  properties: {
    mode: { type: "string", enum: ["tool_output", "semantic_context", "phase_transfer"] },
    evidence: { type: "object", additionalProperties: true },
  },
};

function validateToolOutputEvidence(value: Record<string, unknown>, semantic: boolean): Record<string, unknown> {
  const allowed = [
    "phase", "toolName", "resultKind", "isError", "characters", "bytes", "approximateTokens", "lineCount",
    "consecutiveDuplicateLineRatio", "hasReadRange", "toolOutputTargetTokens", "overSoftToolOutputTarget",
    "operation", "changedState", "containsFailureSignal", "exitStatus", "filePath", ...(semantic ? ["goalSummary"] : []),
  ];
  requireOnlyKeys(value, allowed, ["phase", "toolName", "resultKind", "isError"]);
  requireString(value.phase, 120);
  requireString(value.toolName, 120);
  requireEnum(value.resultKind, ["source_code", "search_output", "command_output", "file_content", "other"] as const);
  if (typeof value.isError !== "boolean") throw new ProfileEngineError("INVALID_PROFILE_INPUT");
  if (typeof value.characters !== "number" || !Number.isFinite(value.characters) || value.characters < 0
    || typeof value.bytes !== "number" || !Number.isFinite(value.bytes) || value.bytes < 0
    || typeof value.approximateTokens !== "number" || !Number.isFinite(value.approximateTokens) || value.approximateTokens < 0
    || typeof value.lineCount !== "number" || !Number.isFinite(value.lineCount) || value.lineCount < 0
    || typeof value.consecutiveDuplicateLineRatio !== "number" || !Number.isFinite(value.consecutiveDuplicateLineRatio)
    || value.consecutiveDuplicateLineRatio < 0 || value.consecutiveDuplicateLineRatio > 1
    || typeof value.hasReadRange !== "boolean") {
    throw new ProfileEngineError("INVALID_PROFILE_INPUT");
  }
  for (const key of ["overSoftToolOutputTarget", "changedState", "containsFailureSignal"]) {
    if (value[key] !== undefined && typeof value[key] !== "boolean") throw new ProfileEngineError("INVALID_PROFILE_INPUT");
  }
  for (const key of ["toolOutputTargetTokens", "exitStatus"]) {
    if (value[key] !== undefined && (!Number.isInteger(value[key]) || (value[key] as number) < 0)) {
      throw new ProfileEngineError("INVALID_PROFILE_INPUT");
    }
  }
  for (const key of ["operation", "filePath", "goalSummary"]) {
    if (value[key] !== undefined) requireString(value[key], key === "goalSummary" ? 1_200 : 256, { allowEmpty: key === "goalSummary" });
  }
  return value;
}

function validatePhaseTransferEvidence(value: Record<string, unknown>): Record<string, unknown> {
  requireOnlyKeys(value, ["phase_from", "phase_to", "goal_summary", "candidates"], ["phase_from", "phase_to", "goal_summary", "candidates"]);
  requireString(value.phase_from, 120);
  if (requireString(value.phase_to, 120) !== "coding") throw new ProfileEngineError("INVALID_PROFILE_INPUT");
  requireString(value.goal_summary, 1_200, { allowEmpty: true });
  if (!Array.isArray(value.candidates) || value.candidates.length < 1 || value.candidates.length > MAX_CANDIDATES) {
    throw new ProfileEngineError("INVALID_PROFILE_INPUT");
  }
  const ids = new Set<string>();
  for (const candidateValue of value.candidates) {
    const candidate = requireRecord(candidateValue);
    requireOnlyKeys(candidate, ["id", "kind", "path", "text"], ["id", "kind", "text"]);
    const id = requireString(candidate.id, 64);
    if (!PHASE_CANDIDATE_ID.test(id) || ids.has(id)) throw new ProfileEngineError("INVALID_PROFILE_INPUT");
    ids.add(id);
    requireEnum(candidate.kind, ["inspected_file", "observation", "plan", "test_impact"] as const);
    if (candidate.path !== undefined) requireString(candidate.path, 256);
    requireString(candidate.text, 700);
  }
  return value;
}

function questionsFor(input: KasekiContextRoutingInput): Record<string, DecisionQuestion> {
  if (input.mode === "tool_output") {
    return { route: {
      type: "choice",
      instructions: "Choose a safe local reduction using only the supplied output metadata. Raw tool text, task text, and command text are not included. Preserve exact content when uncertain, when the result is an error, or when a reduction could hide relevant evidence.",
      criteria: {
        preserve: "Keep result exactly as returned. Use for errors, exact evidence, code requiring implementation details, unfamiliar output, or uncertainty.",
        compact_repeated: "For successful bash/search results with a high ratio of consecutive repeated lines, replace repeated runs with their exact line and an explicit repeat count. Do not alter any other line.",
        structural_code: "For a large, full-file TypeScript or JavaScript read, return an AST structural preview only when a follow-up exact read of the same workspace path can recover implementation details.",
      },
    } };
  }
  if (input.mode === "semantic_context") {
    return { disposition: {
      type: "choice",
      instructions: "Choose whether this tool result should enter the current coding context in full, as a condensed representation, or be safely omitted. Use only the bounded metadata and goal summary provided. Preserve failure evidence, exact source details needed for implementation, state-changing operation evidence, and uncertainty. Condense repetitive successful output or large context that remains useful at lower fidelity. Discard only clearly routine, redundant output that cannot affect the current task.",
      criteria: ROUTES,
    } };
  }
  return Object.fromEntries((input.evidence.candidates as Array<{ id: string }>).map(({ id }) => [id, {
    type: "choice",
    instructions: "Route one bounded scouting fact from the prior scouting phase into the coding phase. Use only this fact and the bounded goal. Preserve task requirements, critical evidence, and uncertainty. Prefer condense to discard when the fact may help implementation or verification.",
    criteria: ROUTES,
  } satisfies DecisionQuestion]));
}

function validateInput(value: unknown): KasekiContextRoutingInput {
  const root = requireRecord(value);
  requireOnlyKeys(root, ["mode", "evidence"], ["mode", "evidence"]);
  const mode = requireEnum(root.mode, ["tool_output", "semantic_context", "phase_transfer"] as const);
  const evidence = requireBoundedJsonObject(root.evidence, MAX_EVIDENCE_BYTES);
  if (mode === "phase_transfer") validatePhaseTransferEvidence(evidence);
  else validateToolOutputEvidence(evidence, mode === "semantic_context");
  const input = { mode, evidence };
  if (Object.keys(questionsFor(input)).length > MAX_CANDIDATES) throw new ProfileEngineError("INVALID_PROFILE_INPUT");
  return input;
}

export const kasekiContextRoutingProfile: DecisionProfile<
  typeof PROFILE_ID,
  "kaseki",
  KasekiContextRoutingInput,
  Record<string, DecisionQuestion>,
  Record<string, DecisionAnswer>
> = {
  id: PROFILE_ID,
  name: "Kaseki context routing",
  description: "Choose advisory context-preservation or local-output reduction routes from bounded evidence; Kaseki deterministic transformations remain authoritative.",
  owner: profileOwner(PROFILE_ID),
  version: "1",
  maxEvidenceBytes: MAX_EVIDENCE_BYTES,
  dynamicQuestions: true,
  maxQuestionCount: MAX_CANDIDATES,
  answerIdPattern: "^(?:route|disposition|(?:file|observation|plan|test)_[0-9]+)$",
  questions: {},
  inputSchema,
  validateInput,
  buildDecision(input) {
    return {
      state: jsonState({ mode: input.mode, evidence: redactKasekiEvidence(input.evidence) }),
      questions: questionsFor(input),
    };
  },
  validateOutput(answers, input) {
    return validateAnswersForQuestions(answers, questionsFor(input)) as Record<string, DecisionAnswer>;
  },
};
