import type { DecisionQuestion } from "../../contracts/decisions";
import type { AnswersFor, DecisionProfile } from "../../contracts/profiles";
import { ProfileEngineError } from "../../contracts/profiles";
import { allowedClientsForProfile, profileOwner } from "../../auth/permissions";
import { jsonState, redactKasekiEvidence, requireOnlyKeys, requireOptionalEnum, requireOptionalStringArray, requireRecord, requireString, validateAnswersForQuestions } from "../validation";

const PROFILE_ID = "task_admission_v1" as const;
const TASK_MODES = ["patch", "inspect"] as const;
const PUBLISH_MODES = ["auto", "none", "branch", "pr"] as const;

const questions = {
  contains_credentials: {
    type: "noul",
    instructions: "Does this task request contain, expose, create, copy, rotate, or exfiltrate credentials or secrets?",
  },
  changes_permissions: {
    type: "noul",
    instructions: "Will this task change permissions, authentication, authorization, ownership, or access control?",
  },
  crosses_security_boundary: {
    type: "noul",
    instructions: "Will this task weaken, bypass, or cross a security boundary or isolation boundary?",
  },
  risk_level: {
    type: "choice",
    instructions: "How risky is this task to run automatically?",
    criteria: {
      low: "Low risk and reversible.",
      review: "Potentially consequential; record increased PR-stage review risk.",
      high: "Destructive, secret-related, or security-sensitive.",
    },
  },
  task_type: {
    type: "choice",
    instructions: "What kind of repository task is requested? Classify the user objective, not incidental wording.",
    criteria: {
      feature: "Add or extend user-facing behavior or capability.",
      bug_fix: "Correct behavior that currently fails or is incorrect.",
      refactor: "Restructure implementation while preserving behavior.",
      documentation: "Change documentation, examples, or explanatory text.",
      investigation: "Inspect or diagnose without necessarily changing code.",
      test_only: "Add or update automated tests without changing production behavior.",
      infrastructure: "Change build, deployment, CI, dependency, or runtime configuration.",
    },
  },
  validation_focus: {
    type: "choice",
    instructions: "Which validation category is most relevant to this task? This is advisory and must not replace explicit commands.",
    criteria: {
      unit_tests: "Focused unit tests are the clearest signal.",
      integration_tests: "Integration or end-to-end checks are the clearest signal.",
      type_and_lint: "Type checking or linting is the clearest signal.",
      docs_checks: "Documentation links, generation, formatting, or examples checks are the clearest signal.",
      repo_defined_checks: "Use the repository’s declared general check or validation target.",
    },
  },
} satisfies Record<string, DecisionQuestion>;

type TaskMode = typeof TASK_MODES[number];
type PublishMode = typeof PUBLISH_MODES[number];

interface AgentStageSettings {
  enabled?: boolean;
  model?: string;
  timeoutSeconds?: number;
}

export interface TaskAdmissionInput {
  repoUrl: string;
  ref?: string;
  taskPrompt?: string;
  validationCommands?: string[];
  changedFilesAllowlist?: string[];
  taskMode?: TaskMode;
  publishMode?: PublishMode;
  startupCheck?: boolean;
  scouting?: AgentStageSettings;
  goalSetting?: AgentStageSettings;
}

export type TaskAdmissionResult = AnswersFor<typeof questions>;

function validateStageSettings(value: unknown): AgentStageSettings | undefined {
  if (value === undefined) return undefined;
  const settings = requireRecord(value);
  requireOnlyKeys(settings, ["enabled", "model", "timeoutSeconds"]);
  const result: AgentStageSettings = {};
  if (settings.enabled !== undefined) {
    if (typeof settings.enabled !== "boolean") throw new ProfileEngineError("INVALID_PROFILE_INPUT");
    result.enabled = settings.enabled;
  }
  if (settings.model !== undefined) result.model = requireString(settings.model, 256);
  if (settings.timeoutSeconds !== undefined) {
    const timeout = settings.timeoutSeconds;
    if (!Number.isInteger(timeout) || (timeout as number) < 60 || (timeout as number) > 10_800) {
      throw new ProfileEngineError("INVALID_PROFILE_INPUT");
    }
    result.timeoutSeconds = timeout as number;
  }
  return result;
}

function validateInput(value: unknown): TaskAdmissionInput {
  const root = requireRecord(value);
  const allowed = [
    "repoUrl", "ref", "taskPrompt", "validationCommands", "changedFilesAllowlist",
    "taskMode", "publishMode", "startupCheck", "scouting", "goalSetting",
  ];
  requireOnlyKeys(root, allowed, ["repoUrl"]);
  const repoUrl = requireString(root.repoUrl, 2_048);
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(repoUrl);
  } catch {
    throw new ProfileEngineError("INVALID_PROFILE_INPUT");
  }
  if ((parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:")
    || !parsedUrl.hostname || parsedUrl.username || parsedUrl.password || parsedUrl.search || parsedUrl.hash) {
    throw new ProfileEngineError("INVALID_PROFILE_INPUT");
  }
  if (root.startupCheck !== undefined && typeof root.startupCheck !== "boolean") {
    throw new ProfileEngineError("INVALID_PROFILE_INPUT");
  }
  return {
    repoUrl,
    ...(root.ref === undefined ? {} : { ref: requireString(root.ref, 256) }),
    ...(root.taskPrompt === undefined ? {} : { taskPrompt: requireString(root.taskPrompt, 16 * 1024, { minCharacters: 10 }) }),
    ...(root.validationCommands === undefined ? {} : { validationCommands: requireOptionalStringArray(root.validationCommands, 32, 512) }),
    ...(root.changedFilesAllowlist === undefined ? {} : { changedFilesAllowlist: requireOptionalStringArray(root.changedFilesAllowlist, 64, 512) }),
    ...(root.taskMode === undefined ? {} : { taskMode: requireOptionalEnum(root.taskMode, TASK_MODES) }),
    ...(root.publishMode === undefined ? {} : { publishMode: requireOptionalEnum(root.publishMode, PUBLISH_MODES) }),
    ...(root.startupCheck === undefined ? {} : { startupCheck: root.startupCheck as boolean }),
    ...(root.scouting === undefined ? {} : { scouting: validateStageSettings(root.scouting) }),
    ...(root.goalSetting === undefined ? {} : { goalSetting: validateStageSettings(root.goalSetting) }),
  };
}

export const taskAdmissionProfile: DecisionProfile<
  typeof PROFILE_ID,
  "kaseki",
  TaskAdmissionInput,
  typeof questions,
  TaskAdmissionResult
> = {
  id: PROFILE_ID,
  name: "Task admission classification",
  description: "Provide advisory risk and routing classifications; Kaseki's deterministic admission policy remains authoritative.",
  owner: profileOwner(PROFILE_ID),
  version: "1",
  allowedClients: allowedClientsForProfile(PROFILE_ID),
  maxEvidenceBytes: 32 * 1024,
  questions,
  validateInput,
  buildDecision(input) {
    const projection = redactKasekiEvidence({
      repoUrl: input.repoUrl,
      ref: input.ref,
      taskPrompt: input.taskPrompt,
      validationCommands: input.validationCommands,
      changedFilesAllowlist: input.changedFilesAllowlist,
      taskMode: input.taskMode,
      publishMode: input.publishMode,
      startupCheck: input.startupCheck,
      scouting: input.scouting,
      goalSetting: input.goalSetting,
    });
    return { state: jsonState(projection), questions };
  },
  validateOutput(answers) {
    return validateAnswersForQuestions(answers, questions);
  },
};
