interface SoyuzEnvironment {
  SENKU: { fetch(request: Request): Promise<Response> };
  SENKU_SOYUZ_API_TOKEN?: string;
  SOYUZ_SIMULATOR_USER_TOKEN?: string;
}

type SoyuzProfileId =
  | "run_operations_triage_v1"
  | "kaseki_output_review_v1"
  | "kaseki_output_review_v2"
  | "run_retry_review_v1";

interface RetainedRun {
  id: string;
  status: string;
  stage: string | null;
  operational_health: string;
  failure_class: string | null;
  created_at: string;
  queued_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  last_heartbeat_at: string | null;
  exit_code: number | null;
  result_json: string | null;
  retry_of: string | null;
  origin_type: string;
  origin_id: string;
  request_json: string;
}

const SOURCE_RUN_ID = "11111111-1111-4111-8111-111111111111";
const RETRY_RUN_ID = "22222222-2222-4222-8222-222222222222";
const MAX_SENKU_RESPONSE_BYTES = 64 * 1024;
const APPROVED_PROFILES: readonly SoyuzProfileId[] = [
  "run_operations_triage_v1",
  "kaseki_output_review_v1",
  "kaseki_output_review_v2",
  "run_retry_review_v1",
];
type SoyuzAnswerContract =
  | { type: "noul" }
  | { type: "choice"; choices: readonly string[] }
  | { type: "score"; legend: readonly string[] };

const JEV_PROFILE_CONTRACTS: Readonly<Record<SoyuzProfileId, {
  version: "1" | "2";
  answers: Readonly<Record<string, SoyuzAnswerContract>>;
}>> = {
  run_operations_triage_v1: {
    version: "1",
    answers: {
      needs_followup: { type: "noul" },
      likely_area: { type: "choice", choices: ["execution", "control_plane", "unknown"] },
      severity: { type: "score", legend: ["Routine", "Needs review", "Urgent"] },
    },
  },
  kaseki_output_review_v1: {
    version: "1",
    answers: {
      summary_specificity: { type: "noul" },
      outcome_alignment: { type: "choice", choices: ["consistent", "unclear", "inconsistent"] },
      evidence_strength: { type: "score", legend: ["Insufficient", "Some concrete detail", "Clear and specific"] },
    },
  },
  kaseki_output_review_v2: {
    version: "2",
    answers: {
      summary_specificity: { type: "noul" },
      outcome_alignment: { type: "choice", choices: ["consistent", "unclear", "inconsistent"] },
      evidence_strength: { type: "score", legend: ["Insufficient", "Some concrete detail", "Clear and specific"] },
      recorded_outcome: {
        type: "score",
        legend: ["Outcome unclear or unsuccessful", "Partial or limited outcome evidence", "Successful and clearly reported outcome"],
      },
    },
  },
  run_retry_review_v1: {
    version: "1",
    answers: {
      recovery: { type: "choice", choices: ["recovered", "partial", "not_recovered", "unclear"] },
      evidence_strength: { type: "score", legend: ["Insufficient", "Some concrete detail", "Clear and specific"] },
      needs_followup: { type: "noul" },
    },
  },
};

// Sanitized RunRow-shaped fixtures based on Soyuz src/db/runs.ts. The raw request stays in
// request_json to prove that the analysis projection never forwards the user's task prompt.
const runs = new Map<string, RetainedRun>([
  [SOURCE_RUN_ID, {
    id: SOURCE_RUN_ID,
    status: "failed",
    stage: "validation",
    operational_health: "suspect_stalled",
    failure_class: "provider_failure",
    created_at: "2026-11-08T12:00:00.000Z",
    queued_at: "2026-11-08T12:00:01.000Z",
    started_at: "2026-11-08T12:00:02.000Z",
    completed_at: "2026-11-08T12:00:03.000Z",
    last_heartbeat_at: "2026-11-08T12:00:02.500Z",
    exit_code: 1,
    result_json: JSON.stringify({ summary: "The original validation timed out.", changedFileCount: 2 }),
    retry_of: null,
    origin_type: "dashboard",
    origin_id: "synthetic-dashboard-user",
    request_json: JSON.stringify({ taskPrompt: "SYNTHETIC_SOYUZ_TASK_PROMPT_MUST_STAY_IN_SOYUZ" }),
  }],
  [RETRY_RUN_ID, {
    id: RETRY_RUN_ID,
    status: "completed",
    stage: null,
    operational_health: "healthy",
    failure_class: null,
    created_at: "2026-11-08T12:05:00.000Z",
    queued_at: "2026-11-08T12:05:01.000Z",
    started_at: "2026-11-08T12:05:02.000Z",
    completed_at: "2026-11-08T12:05:10.000Z",
    last_heartbeat_at: "2026-11-08T12:05:09.000Z",
    exit_code: 0,
    result_json: JSON.stringify({ summary: "The retry passed validation.", changedFileCount: 3 }),
    retry_of: SOURCE_RUN_ID,
    origin_type: "dashboard",
    origin_id: "synthetic-dashboard-user",
    request_json: JSON.stringify({ taskPrompt: "SYNTHETIC_SOYUZ_TASK_PROMPT_MUST_STAY_IN_SOYUZ" }),
  }],
  ["44444444-4444-4444-8444-444444444444", {
    id: "44444444-4444-4444-8444-444444444444",
    status: "completed",
    stage: null,
    operational_health: "healthy",
    failure_class: null,
    created_at: "2026-11-08T12:10:00.000Z",
    queued_at: "2026-11-08T12:10:01.000Z",
    started_at: "2026-11-08T12:10:02.000Z",
    completed_at: "2026-11-08T12:10:10.000Z",
    last_heartbeat_at: "2026-11-08T12:10:09.000Z",
    // Deliberately malformed retained data to exercise the bounded Senku projection.
    exit_code: 9_999,
    result_json: JSON.stringify({ summary: "The exit code is malformed in this retained record.", changedFileCount: 1 }),
    retry_of: null,
    origin_type: "dashboard",
    origin_id: "synthetic-dashboard-user",
    request_json: JSON.stringify({ taskPrompt: "SYNTHETIC_SOYUZ_TASK_PROMPT_MUST_STAY_IN_SOYUZ" }),
  }],
]);

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function parseResult(row: RetainedRun): Record<string, unknown> | null {
  if (!row.result_json) return null;
  try {
    const value: unknown = JSON.parse(row.result_json);
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

function boundedSummary(row: RetainedRun): string | null {
  const summary = parseResult(row)?.summary;
  return typeof summary === "string" ? Array.from(summary).slice(0, 2_000).join("") : null;
}

function boundedChangedFileCount(row: RetainedRun): number | null {
  const count = parseResult(row)?.changedFileCount;
  return typeof count === "number" && Number.isSafeInteger(count) && count >= 0 && count <= 1_000_000
    ? count
    : null;
}

function boundedExitCode(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= -1 && value <= 255 ? value : null;
}

function retryEvidence(row: RetainedRun): Record<string, unknown> {
  return {
    status: row.status,
    failureClass: typeof row.failure_class === "string" && row.failure_class.length <= 128 ? row.failure_class : null,
    exitCode: boundedExitCode(row.exit_code),
    changedFileCount: boundedChangedFileCount(row),
    summary: boundedSummary(row),
  };
}

function buildSenkuInput(profileId: SoyuzProfileId, row: RetainedRun, source?: RetainedRun): Record<string, unknown> {
  switch (profileId) {
    case "run_operations_triage_v1":
      return {
        run: {
          status: row.status,
          stage: row.stage,
          operationalHealth: row.operational_health,
          failureClass: row.failure_class,
          createdAt: row.created_at,
          queuedAt: row.queued_at,
          startedAt: row.started_at,
          completedAt: row.completed_at,
          lastHeartbeatAt: row.last_heartbeat_at,
        },
      };
    case "kaseki_output_review_v1":
    case "kaseki_output_review_v2":
      return {
        canonicalRun: {
          status: row.status,
          failureClass: row.failure_class,
          exitCode: boundedExitCode(row.exit_code),
          changedFileCount: boundedChangedFileCount(row),
        },
        summary: boundedSummary(row),
      };
    case "run_retry_review_v1":
      if (!source) throw new Error("retry_source_missing");
      return { retryComparison: { source: retryEvidence(source), retry: retryEvidence(row) } };
  }
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const keys = [...expected].sort();
  return actual.length === keys.length && actual.every((key, index) => key === keys[index]);
}

function probability(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function confidence(value: unknown): boolean {
  return value === null || probability(value);
}

function probabilityMap(value: unknown, keys: readonly string[]): value is Record<string, number> {
  if (!isRecord(value) || !hasExactKeys(value, keys)) return false;
  const values = keys.map((key) => value[key]);
  return values.every(probability) && Math.abs(values.reduce((sum, item) => sum + item, 0) - 1) <= 0.03;
}

function validAnswer(value: unknown, contract: SoyuzAnswerContract): boolean {
  if (!isRecord(value)) return false;
  if (contract.type === "noul") {
    return hasExactKeys(value, ["type", "noul", "probabilities", "confidence"])
      && value.type === "noul"
      && probability(value.noul)
      && probabilityMap(value.probabilities, ["false", "true"])
      && Math.abs(value.probabilities.true - value.noul) <= 0.000001
      && value.confidence === null;
  }
  if (contract.type === "choice") {
    return hasExactKeys(value, ["type", "choice", "probabilities", "confidence"])
      && value.type === "choice"
      && typeof value.choice === "string"
      && contract.choices.includes(value.choice)
      && probabilityMap(value.probabilities, contract.choices)
      && confidence(value.confidence);
  }
  const scoreKeys = contract.legend.map((_label, index) => String(index));
  const legend = value.legend;
  return hasExactKeys(value, ["type", "score", "legend", "probabilities", "confidence"])
    && value.type === "score"
    && typeof value.score === "number"
    && Number.isFinite(value.score)
    && value.score >= 0
    && value.score <= contract.legend.length - 1
    && isRecord(legend)
    && hasExactKeys(legend, scoreKeys)
    && scoreKeys.every((key, index) => legend[key] === contract.legend[index])
    && probabilityMap(value.probabilities, scoreKeys)
    && confidence(value.confidence);
}

function validAnswerSet(profileId: SoyuzProfileId, value: unknown): value is Record<string, unknown> {
  const contracts = JEV_PROFILE_CONTRACTS[profileId].answers;
  if (!isRecord(value) || !hasExactKeys(value, Object.keys(contracts))) return false;
  return Object.entries(contracts).every(([key, contract]) => validAnswer(value[key], contract));
}

function sortedJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortedJson);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortedJson(value[key])]));
}

function usageIsValid(value: unknown): boolean {
  if (!isRecord(value) || !Object.keys(value).every((key) => ["input_tokens", "output_tokens", "total_tokens", "cost"].includes(key))) return false;
  return ["input_tokens", "output_tokens", "total_tokens"].every((key) =>
    value[key] === undefined || (Number.isSafeInteger(value[key]) && (value[key] as number) >= 0))
    && (value.cost === undefined || (typeof value.cost === "number" && Number.isFinite(value.cost) && value.cost >= 0));
}

function validSenkuSuccess(value: unknown, profileId: SoyuzProfileId): value is Record<string, unknown> {
  const required = [
    "schemaVersion", "requestId", "status", "profileId", "profileVersion", "provider",
    "model", "answers", "result", "durationMs", "attemptCount",
  ];
  if (!isRecord(value) || !required.every((key) => Object.hasOwn(value, key))) return false;
  if (!Object.keys(value).every((key) => [...required, "usage"].includes(key))) return false;
  return value.schemaVersion === "1"
    && typeof value.requestId === "string"
    && /^dec-[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.requestId)
    && value.status === "completed"
    && value.profileId === profileId
    && value.profileVersion === JEV_PROFILE_CONTRACTS[profileId].version
    && value.provider === "jev"
    && typeof value.model === "string"
    && value.model.trim().length > 0
    && value.model.length <= 200
    && Number.isSafeInteger(value.durationMs)
    && (value.durationMs as number) >= 0
    && value.attemptCount === 1
    && validAnswerSet(profileId, value.answers)
    && validAnswerSet(profileId, value.result)
    && JSON.stringify(sortedJson(value.answers)) === JSON.stringify(sortedJson(value.result))
    && (!Object.hasOwn(value, "usage") || usageIsValid(value.usage));
}

async function readBoundedSenkuJson(response: Response): Promise<unknown> {
  if (!/^\s*application\/json(?:\s*;[^\r\n]*)?\s*$/i.test(response.headers.get("content-type") ?? "") || !response.body) {
    throw new Error("invalid_senku_response");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_SENKU_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new Error("senku_response_too_large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
}

function mapSenkuFailure(status: number, payload: unknown): Response {
  const code = isRecord(payload) && isRecord(payload.error) && typeof payload.error.code === "string"
    ? payload.error.code
    : "";
  if (code === "PROVIDER_TIMEOUT" || status === 408 || status === 504) {
    return jsonResponse({ error: { code: "JEV_PROVIDER_TIMEOUT", message: "JEV analysis timed out." } }, 504);
  }
  if (code === "INVALID_PROVIDER_RESPONSE") {
    return jsonResponse({ error: { code: "JEV_RESPONSE_INVALID", message: "Senku returned an unsupported decision response." } }, 502);
  }
  if (code === "NOT_CONFIGURED") {
    return jsonResponse({ error: { code: "JEV_UNAVAILABLE", message: "JEV analysis is not configured." } }, 503);
  }
  if (code === "INVALID_REQUEST" || code === "UNSUPPORTED_SCHEMA_VERSION" || code === "PAYLOAD_TOO_LARGE"
    || status === 400 || status === 413) {
    return jsonResponse({ error: { code: "JEV_REQUEST_INVALID", message: "Soyuz could not prepare the approved decision request." } }, 500);
  }
  return jsonResponse({ error: { code: "JEV_PROVIDER_UNAVAILABLE", message: "JEV analysis could not reach Senku." } }, 502);
}

async function handleAnalysis(request: Request, env: SoyuzEnvironment): Promise<Response> {
  if (!env.SOYUZ_SIMULATOR_USER_TOKEN?.trim()
    || request.headers.get("authorization") !== `Bearer ${env.SOYUZ_SIMULATOR_USER_TOKEN}`) {
    return jsonResponse({ error: { code: "UNAUTHENTICATED", message: "Authentication is required." } }, 401);
  }
  if (!env.SENKU_SOYUZ_API_TOKEN?.trim()) {
    return jsonResponse({ error: { code: "JEV_UNAVAILABLE", message: "JEV analysis is not configured." } }, 503);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: { code: "INVALID_REQUEST", message: "Decision request is invalid." } }, 400);
  }
  if (!isRecord(body)
    || Object.keys(body).sort().join(",") !== "profileId,runId"
    || typeof body.profileId !== "string"
    || !APPROVED_PROFILES.includes(body.profileId as SoyuzProfileId)
    || typeof body.runId !== "string"
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.runId)) {
    return jsonResponse({ error: { code: "INVALID_REQUEST", message: "Decision request must contain an approved profile and a run UUID." } }, 400);
  }

  const profileId = body.profileId as SoyuzProfileId;
  const row = runs.get(body.runId);
  if (!row) return jsonResponse({ error: { code: "RUN_NOT_FOUND", message: "Run was not found." } }, 404);

  let source: RetainedRun | undefined;
  if (profileId === "run_retry_review_v1") {
    if (!row.retry_of) return jsonResponse({ error: { code: "JEV_PROFILE_NOT_APPLICABLE", message: "Retry comparison is unavailable." } }, 409);
    source = runs.get(row.retry_of);
    if (!source || source.origin_type !== row.origin_type || source.origin_id !== row.origin_id) {
      return jsonResponse({ error: { code: "JEV_PROFILE_NOT_APPLICABLE", message: "Retry comparison is unavailable." } }, 409);
    }
  }

  const input = buildSenkuInput(profileId, row, source);
  let response: Response;
  try {
    response = await env.SENKU.fetch(new Request(`https://senku.internal/v1/profiles/${profileId}/evaluate`, {
      method: "POST",
      redirect: "manual",
      signal: AbortSignal.timeout(35_000),
      headers: {
        authorization: `Bearer ${env.SENKU_SOYUZ_API_TOKEN}`,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({ schemaVersion: "1", input }),
    }));
  } catch {
    return jsonResponse({ error: { code: "JEV_PROVIDER_UNAVAILABLE", message: "JEV analysis could not reach Senku." } }, 502);
  }

  let payload: unknown;
  try {
    payload = await readBoundedSenkuJson(response);
  } catch {
    if (!response.ok) return mapSenkuFailure(response.status, undefined);
    return jsonResponse({ error: { code: "JEV_RESPONSE_INVALID", message: "Senku returned an unsupported decision response." } }, 502);
  }
  if (!response.ok) return mapSenkuFailure(response.status, payload);
  if (!validSenkuSuccess(payload, profileId)) {
    return jsonResponse({ error: { code: "JEV_RESPONSE_INVALID", message: "Senku returned an unsupported decision response." } }, 502);
  }

  return jsonResponse({ data: { model: payload.model, answers: payload.answers } });
}

export default {
  async fetch(request: Request, env: SoyuzEnvironment): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/dashboard/api/analysis/decisions" && request.method === "POST") {
      return handleAnalysis(request, env);
    }
    if (url.pathname.startsWith("/dashboard/api/analysis/decisions")) {
      return jsonResponse({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed." } }, 405);
    }
    return jsonResponse({ error: { code: "NOT_FOUND", message: "Not found." } }, 404);
  },
};
