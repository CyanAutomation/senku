import type { DecisionQuestion } from "../../contracts/decisions";
import type { AnswersFor, DecisionProfile } from "../../contracts/profiles";
import { ProfileEngineError } from "../../contracts/profiles";
import { allowedClientsForProfile, profileOwner } from "../../auth/permissions";
import { jsonState, redactKasekiEvidence, requireOnlyKeys, requireRecord, requireString, validateAnswersForQuestions } from "../validation";

const PROFILE_ID = "validation_recovery_v1" as const;

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
  const output = requireString(root.output, 12_000, { allowEmpty: true });
  if (output.length > 6_000) throw new ProfileEngineError("INVALID_PROFILE_INPUT");
  return {
    command: requireString(root.command, 1_000),
    exitCode: root.exitCode as number,
    output,
  };
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
  allowedClients: allowedClientsForProfile(PROFILE_ID),
  maxEvidenceBytes: 8 * 1024,
  questions,
  validateInput,
  buildDecision(input) {
    const safe = redactKasekiEvidence({
      command: input.command,
      exit_code: input.exitCode,
      failure_output: input.output.slice(-5_000),
    });
    return { state: jsonState(safe), questions };
  },
  validateOutput(answers) {
    return validateAnswersForQuestions(answers, questions);
  },
};
