import type { DecisionQuestion } from "../../contracts/decisions";
import type { AnswersFor, DecisionProfile, JsonSchema } from "../../contracts/profiles";
import { ProfileEngineError } from "../../contracts/profiles";
import { profileOwner } from "../../auth/permissions";
import { jsonState, redactKasekiEvidence, requireOnlyKeys, requireRecord, requireString, validateAnswersForQuestions } from "../validation";

const PROFILE_ID = "validation_recovery_v1" as const;
const MAX_FAILURE_OUTPUT_BYTES = 6_000;
const MAX_FAILURE_OUTPUT_TAIL_CODE_UNITS = 5_000;
const MAX_EVIDENCE_BYTES = 8 * 1024;

const inputSchema: JsonSchema = {
  type: "object",
  required: ["command", "exitCode", "output"],
  additionalProperties: false,
  properties: {
    command: { type: "string", minLength: 1, maxLength: 1_000, pattern: "\\S", "x-maxBytes": 1_000 },
    exitCode: { type: "integer", minimum: 0, maximum: 255 },
    output: { type: "string", maxLength: MAX_FAILURE_OUTPUT_BYTES, "x-maxBytes": MAX_FAILURE_OUTPUT_BYTES, description: "Bounded output text. Redaction is applied before retaining its tail." },
  },
};

const questions = {
  validation_failure_cause: {
    type: "choice",
    instructions: "Classify the most likely cause of this validation failure from the supplied command, exit status, and bounded failure output.",
    criteria: {
      test_failure: "A test assertion or behavioral check failed.",
      type_or_lint_failure: "Type checking, linting, or formatting failed.",
      build_failure: "Compilation, bundling, or build failed.",
      dependency_or_environment: "A dependency, service, platform, or environment problem caused the failure.",
      timeout_or_flaky: "The evidence points to a timeout or intermittent failure.",
      implementation_logic: "The code change appears to cause incorrect behavior.",
      unknown: "The available evidence does not support a more specific cause.",
    },
  },
  validation_recovery_action: {
    type: "choice",
    instructions: "Recommend the safest next validation workflow action. A retry is only a recommendation and is subject to local retry policy.",
    criteria: {
      fix_implementation: "Correct the implementation, then rerun the requested checks.",
      repair_environment: "Repair the dependency or environment issue, then rerun the requested checks.",
      retry_validation_once: "Retry the same validation command once to confirm a likely transient failure.",
      inspect_diagnostics: "Use the retained logs and failure artifact to narrow the cause before changing code.",
    },
  },
} satisfies Record<string, DecisionQuestion>;

export interface ValidationRecoveryInput {
  command: string;
  exitCode: number;
  output: string;
}

export type ValidationRecoveryResult = AnswersFor<typeof questions>;

function validateInput(value: unknown): ValidationRecoveryInput {
  const root = requireRecord(value);
  requireOnlyKeys(root, ["command", "exitCode", "output"], ["command", "exitCode", "output"]);
  if (!Number.isSafeInteger(root.exitCode) || (root.exitCode as number) < 0 || (root.exitCode as number) > 255) {
    throw new ProfileEngineError("INVALID_PROFILE_INPUT");
  }
  const output = requireString(root.output, MAX_FAILURE_OUTPUT_BYTES, { allowEmpty: true });
  return {
    command: requireString(root.command, 1_000),
    exitCode: root.exitCode as number,
    output,
  };
}

function tailByCodeUnits(value: string, maximum: number): string {
  let start = Math.max(0, value.length - maximum);
  if (start > 0 && /[\uDC00-\uDFFF]/.test(value[start])) start += 1;
  return value.slice(start);
}

function validationState(command: string, exitCode: number, output: string): string {
  return jsonState({ command, exit_code: exitCode, failure_output: output });
}

function fitOutputToEvidenceLimit(command: string, exitCode: number, output: string): string {
  let state = validationState(command, exitCode, output);
  if (new TextEncoder().encode(state).byteLength <= MAX_EVIDENCE_BYTES) return state;

  const codePoints = Array.from(output);
  let lower = 0;
  let upper = codePoints.length;
  while (lower < upper) {
    const middle = Math.ceil((lower + upper) / 2);
    const candidate = codePoints.slice(codePoints.length - middle).join("");
    state = validationState(command, exitCode, candidate);
    if (new TextEncoder().encode(state).byteLength <= MAX_EVIDENCE_BYTES) lower = middle;
    else upper = middle - 1;
  }
  const fitted = codePoints.slice(codePoints.length - lower).join("");
  state = validationState(command, exitCode, fitted);
  if (new TextEncoder().encode(state).byteLength > MAX_EVIDENCE_BYTES) {
    throw new ProfileEngineError("PROFILE_INPUT_TOO_LARGE");
  }
  return state;
}

export const validationRecoveryProfile: DecisionProfile<
  typeof PROFILE_ID,
  "kaseki",
  ValidationRecoveryInput,
  typeof questions,
  ValidationRecoveryResult
> = {
  id: PROFILE_ID,
  name: "Validation recovery classification",
  description: "Classify bounded validation failure evidence and recommend an advisory next step.",
  owner: profileOwner(PROFILE_ID),
  version: "1",
  maxEvidenceBytes: 8 * 1024,
  questions,
  inputSchema,
  validateInput,
  buildDecision(input) {
    const redacted = redactKasekiEvidence({ command: input.command, output: input.output }) as {
      command: string;
      output: string;
    };
    const redactedTail = tailByCodeUnits(redacted.output, MAX_FAILURE_OUTPUT_TAIL_CODE_UNITS);
    return {
      state: fitOutputToEvidenceLimit(redacted.command, input.exitCode, redactedTail),
      questions,
    };
  },
  validateOutput(answers) {
    return validateAnswersForQuestions(answers, questions);
  },
};
