import type { DecisionAnswer, DecisionQuestion } from "../../contracts/decisions";
import type { AnswersFor, DecisionProfile, JsonSchema } from "../../contracts/profiles";
import { ProfileEngineError } from "../../contracts/profiles";
import { profileOwner } from "../../auth/permissions";
import { jsonState, requireEnum, requireOnlyKeys, requireRecord, requireString, validateAnswersForQuestions } from "../validation";

const PROFILE_ID = "run_operations_triage_v1" as const;
const RUN_STATUSES = [
  "admitting", "queued", "claimed", "running", "cancel_requested", "cancelled",
  "completed", "failed", "admission_failed",
] as const;
const OPERATIONAL_HEALTH = ["unknown", "healthy", "suspect_stalled"] as const;

const inputSchema: JsonSchema = {
  type: "object",
  required: ["run"],
  additionalProperties: false,
  properties: {
    run: {
      type: "object",
      required: ["status", "stage", "operationalHealth", "failureClass", "createdAt", "queuedAt", "startedAt", "completedAt", "lastHeartbeatAt"],
      additionalProperties: false,
      properties: {
        status: { type: "string", enum: RUN_STATUSES },
        stage: { type: ["string", "null"], minLength: 1, maxLength: 128, pattern: "\\S", "x-maxBytes": 128 },
        operationalHealth: { type: "string", enum: OPERATIONAL_HEALTH },
        failureClass: { type: ["string", "null"], minLength: 1, maxLength: 128, pattern: "\\S", "x-maxBytes": 128 },
        createdAt: { type: "string", format: "date-time", pattern: "^\\d{4}-\\d{2}-\\d{2}T", maxLength: 64, "x-maxBytes": 64 },
        queuedAt: { type: ["string", "null"], format: "date-time", pattern: "^\\d{4}-\\d{2}-\\d{2}T", maxLength: 64, "x-maxBytes": 64 },
        startedAt: { type: ["string", "null"], format: "date-time", pattern: "^\\d{4}-\\d{2}-\\d{2}T", maxLength: 64, "x-maxBytes": 64 },
        completedAt: { type: ["string", "null"], format: "date-time", pattern: "^\\d{4}-\\d{2}-\\d{2}T", maxLength: 64, "x-maxBytes": 64 },
        lastHeartbeatAt: { type: ["string", "null"], format: "date-time", pattern: "^\\d{4}-\\d{2}-\\d{2}T", maxLength: 64, "x-maxBytes": 64 },
      },
    },
  },
};

const questions = {
  needs_followup: {
    type: "noul",
    instructions: "Does this run record warrant human follow-up now? Use only the run status and operational-health fields.",
    criteria: {
      true: "The run is failed, appears stalled, or has unresolved operational risk.",
      false: "The run is healthy, terminal without concern, or does not warrant follow-up.",
    },
  },
  likely_area: {
    type: "choice",
    instructions: "Which area most likely owns the operational issue, if any?",
    criteria: {
      execution: "Kaseki execution, repository task, validation, or publication.",
      control_plane: "Soyuz admission, queue handoff, callbacks, or retained run state.",
      unknown: "The available operational metadata is insufficient to identify an area.",
    },
  },
  severity: {
    type: "score",
    instructions: "Rate the operational urgency using only the recorded run metadata.",
    criteria: ["Routine", "Needs review", "Urgent"],
  },
} satisfies Record<string, DecisionQuestion>;

export interface RunOperationsTriageInput {
  run: {
    status: typeof RUN_STATUSES[number];
    stage: string | null;
    operationalHealth: typeof OPERATIONAL_HEALTH[number];
    failureClass: string | null;
    createdAt: string;
    queuedAt: string | null;
    startedAt: string | null;
    completedAt: string | null;
    lastHeartbeatAt: string | null;
  };
}

export type RunOperationsTriageResult = AnswersFor<typeof questions>;

function timestamp(value: unknown, nullable: boolean): string | null {
  if (nullable && value === null) return null;
  const text = requireString(value, 64);
  if (!/^\d{4}-\d\d-\d\dT/.test(text) || !Number.isFinite(Date.parse(text))) {
    throw new ProfileEngineError("INVALID_PROFILE_INPUT");
  }
  return text;
}

function validateInput(value: unknown): RunOperationsTriageInput {
  const root = requireRecord(value);
  requireOnlyKeys(root, ["run"], ["run"]);
  const run = requireRecord(root.run);
  const keys = ["status", "stage", "operationalHealth", "failureClass", "createdAt", "queuedAt", "startedAt", "completedAt", "lastHeartbeatAt"];
  requireOnlyKeys(run, keys, keys);
  const nullableText = (field: unknown, maxBytes: number): string | null =>
    field === null ? null : requireString(field, maxBytes);
  return {
    run: {
      status: requireEnum(run.status, RUN_STATUSES),
      stage: nullableText(run.stage, 128),
      operationalHealth: requireEnum(run.operationalHealth, OPERATIONAL_HEALTH),
      failureClass: nullableText(run.failureClass, 128),
      createdAt: timestamp(run.createdAt, false) as string,
      queuedAt: timestamp(run.queuedAt, true),
      startedAt: timestamp(run.startedAt, true),
      completedAt: timestamp(run.completedAt, true),
      lastHeartbeatAt: timestamp(run.lastHeartbeatAt, true),
    },
  };
}

export const runOperationsTriageProfile: DecisionProfile<
  typeof PROFILE_ID,
  "soyuz",
  RunOperationsTriageInput,
  typeof questions,
  RunOperationsTriageResult
> = {
  id: PROFILE_ID,
  name: "Run operations triage",
  description: "Assess retained Kaseki run operational metadata using Soyuz's approved projection.",
  owner: profileOwner(PROFILE_ID),
  version: "1",
  maxEvidenceBytes: 12 * 1024,
  questions,
  inputSchema,
  validateInput,
  buildDecision(input) {
    return {
      state: jsonState({
        source: "soyuz_run_operational_metadata",
        run: {
          status: input.run.status,
          stage: input.run.stage,
          operationalHealth: input.run.operationalHealth,
          failureClass: input.run.failureClass,
          createdAt: input.run.createdAt,
          queuedAt: input.run.queuedAt,
          startedAt: input.run.startedAt,
          completedAt: input.run.completedAt,
          lastHeartbeatAt: input.run.lastHeartbeatAt,
        },
      }),
      questions,
    };
  },
  validateOutput(answers) {
    return validateAnswersForQuestions(answers, questions);
  },
};
