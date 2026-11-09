import {
  LIMITS,
  type ChoiceAnswer,
  type ChoiceQuestion,
  type DecisionAnswer,
  type DecisionQuestion,
  type DecisionRequest,
  type DecisionResponse,
  type Environment,
  type NoulAnswer,
  type ProviderUsage,
  type ScoreAnswer,
  type ScoreQuestion,
} from "../../contracts/decisions";

export const OPENROUTER_DECISIONS_URL = "https://openrouter.ai/api/alpha/decisions";
export const DEFAULT_JEV_MODEL = "~typesafe/jev-latest";
export const DEFAULT_PROVIDER_TIMEOUT_MS = 15_000;
export const MIN_PROVIDER_TIMEOUT_MS = 1_000;
export const MAX_PROVIDER_TIMEOUT_MS = 30_000;
const MAX_API_KEY_BYTES = 4_096;
const MAX_ANNOTATIONS = 32;
const MAX_ANNOTATION_BYTES = 16 * 1024;
const MAX_ANNOTATION_NODES = 2_048;
const MAX_ANNOTATION_DEPTH = 16;

export type ProviderErrorCode = "PROVIDER_TIMEOUT" | "PROVIDER_UNAVAILABLE" | "INVALID_PROVIDER_RESPONSE";

export class ProviderError extends Error {
  constructor(readonly code: ProviderErrorCode, readonly retryable: boolean) {
    super(code);
    this.name = "ProviderError";
  }
}

export type ProviderConfig =
  | { ok: true; apiKey: string; model: string; timeoutMs: number }
  | { ok: false };

export function resolveProviderConfig(env: Environment): ProviderConfig {
  const apiKey = env.OPENROUTER_API_KEY?.trim();
  const configuredModel = env.JEV_MODEL;
  const timeoutValue = env.SENKU_PROVIDER_TIMEOUT_MS?.trim();
  const timeoutMs = timeoutValue ? Number(timeoutValue) : DEFAULT_PROVIDER_TIMEOUT_MS;
  if (!apiKey || new TextEncoder().encode(apiKey).byteLength > MAX_API_KEY_BYTES
    || (configuredModel !== undefined && configuredModel !== DEFAULT_JEV_MODEL)
    || !Number.isInteger(timeoutMs) || timeoutMs < MIN_PROVIDER_TIMEOUT_MS || timeoutMs > MAX_PROVIDER_TIMEOUT_MS) {
    return { ok: false };
  }
  return { ok: true, apiKey, model: DEFAULT_JEV_MODEL, timeoutMs };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function isProbability(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function isExactDistribution(value: unknown, expectedKeys: string[]): value is Record<string, number> {
  if (!isRecord(value)) return false;
  const actualKeys = Object.keys(value);
  if (actualKeys.length !== expectedKeys.length
    || !expectedKeys.every((key) => Object.hasOwn(value, key))
    || !Object.values(value).every(isProbability)) {
    return false;
  }
  let sum = 0;
  for (const probability of Object.values(value)) {
    if (!isProbability(probability)) return false;
    sum += probability;
  }
  return Math.abs(sum - 1) <= LIMITS.probabilityTolerance;
}

function optionalConfidence(value: unknown): number | null | undefined {
  if (value === undefined || value === null) return null;
  return isProbability(value) ? value : undefined;
}

function isBoundedAnnotationValue(value: unknown, depth: number, budget: { nodes: number }): boolean {
  budget.nodes += 1;
  if (budget.nodes > MAX_ANNOTATION_NODES || depth > MAX_ANNOTATION_DEPTH) return false;
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((item) => isBoundedAnnotationValue(item, depth + 1, budget));
  if (!isRecord(value)) return false;
  return Object.values(value).every((item) => isBoundedAnnotationValue(item, depth + 1, budget));
}

function validAnnotations(value: unknown): boolean {
  if (value === undefined) return true;
  if (!Array.isArray(value) || value.length > MAX_ANNOTATIONS) return false;
  const budget = { nodes: 0 };
  if (!value.every((annotation) => isRecord(annotation)
    && Object.keys(annotation).length > 0
    && isBoundedAnnotationValue(annotation, 0, budget))) {
    return false;
  }
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength <= MAX_ANNOTATION_BYTES;
  } catch {
    return false;
  }
}

function expectedScoreLegend(question: ScoreQuestion): Record<string, string> {
  return Object.fromEntries(question.criteria.map((criterion, index) => [
    String(index),
    typeof criterion === "string" ? criterion : JSON.stringify(criterion),
  ]));
}

function validScoreLegend(value: unknown, question: ScoreQuestion, expectedKeys: string[]): Record<string, string> | null {
  const canonical = expectedScoreLegend(question);
  if (value === undefined) return canonical;
  if (!isRecord(value)) return null;
  const actualKeys = Object.keys(value);
  if (actualKeys.length !== expectedKeys.length || !expectedKeys.every((key) => Object.hasOwn(value, key))) return null;
  for (const key of expectedKeys) {
    if (typeof value[key] !== "string" || value[key].length === 0 || Array.from(value[key]).length > 1_000) return null;
    const criterion = question.criteria[Number(key)];
    if (typeof criterion === "string" && value[key] !== criterion) return null;
  }
  return value as Record<string, string>;
}

function validateNoulAnswer(value: unknown): NoulAnswer | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ["type", "noul"])
    || value.type !== "noul" || !isProbability(value.noul)) {
    return null;
  }
  return {
    type: "noul",
    noul: value.noul,
    probabilities: { false: 1 - value.noul, true: value.noul },
    confidence: null,
  };
}

function validateChoiceAnswer(value: unknown, question: ChoiceQuestion): ChoiceAnswer | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ["type", "choice", "probabilities", "confidence"])
    || value.type !== "choice" || typeof value.choice !== "string"
    || !Object.hasOwn(question.criteria, value.choice)) {
    return null;
  }
  const optionKeys = Object.keys(question.criteria);
  if (!isExactDistribution(value.probabilities, optionKeys)) return null;
  const confidence = optionalConfidence(value.confidence);
  if (confidence === undefined) return null;
  return {
    type: "choice",
    choice: value.choice,
    probabilities: value.probabilities,
    confidence,
  };
}

function validateScoreAnswer(value: unknown, question: ScoreQuestion): ScoreAnswer | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ["type", "score", "legend", "probabilities", "confidence"])
    || value.type !== "score" || typeof value.score !== "number" || !Number.isFinite(value.score)
    || value.score < 0 || value.score > question.criteria.length - 1) {
    return null;
  }
  const scoreKeys = question.criteria.map((_criterion, index) => String(index));
  if (!isExactDistribution(value.probabilities, scoreKeys)) return null;
  const legend = validScoreLegend(value.legend, question, scoreKeys);
  const confidence = optionalConfidence(value.confidence);
  if (!legend || confidence === undefined) return null;
  return {
    type: "score",
    score: value.score,
    legend,
    probabilities: value.probabilities,
    confidence,
  };
}

function validateAnswer(value: unknown, question: DecisionQuestion): DecisionAnswer | null {
  if (!isRecord(value) || value.type !== question.type) return null;
  if (question.type === "noul") return validateNoulAnswer(value);
  if (question.type === "choice") return validateChoiceAnswer(value, question);
  return validateScoreAnswer(value, question);
}

function normalizeUsage(value: unknown): ProviderUsage | undefined | null {
  if (value === undefined) return undefined;
  if (!isRecord(value) || !hasOnlyKeys(value, ["input_tokens", "output_tokens", "total_tokens", "cost"])) return null;
  const result: ProviderUsage = {};
  for (const key of ["input_tokens", "output_tokens", "total_tokens"] as const) {
    if (value[key] === undefined) continue;
    if (!Number.isSafeInteger(value[key]) || (value[key] as number) < 0) return null;
    result[key] = value[key] as number;
  }
  if (value.cost !== undefined) {
    if (typeof value.cost !== "number" || !Number.isFinite(value.cost) || value.cost < 0) return null;
    result.cost = value.cost;
  }
  return result;
}

function validateProviderPayload(value: unknown, request: DecisionRequest): {
  model: string;
  answers: Record<string, DecisionAnswer>;
  usage?: ProviderUsage;
} {
  if (!isRecord(value)
    || !hasOnlyKeys(value, ["model", "answers", "usage", "id", "provider", "annotations"])
    || typeof value.model !== "string" || value.model.trim().length === 0 || value.model.length > 200
    || !isRecord(value.answers)) {
    throw new ProviderError("INVALID_PROVIDER_RESPONSE", false);
  }
  if ((value.id !== undefined && (typeof value.id !== "string" || value.id.length > 256))
    || (value.provider !== undefined && (typeof value.provider !== "string" || value.provider.length > 128))
    || !validAnnotations(value.annotations)) {
    throw new ProviderError("INVALID_PROVIDER_RESPONSE", false);
  }

  const expectedKeys = Object.keys(request.questions);
  const answerKeys = Object.keys(value.answers);
  if (expectedKeys.length !== answerKeys.length
    || !expectedKeys.every((key) => Object.hasOwn(value.answers as object, key))) {
    throw new ProviderError("INVALID_PROVIDER_RESPONSE", false);
  }
  const answers: Record<string, DecisionAnswer> = Object.create(null) as Record<string, DecisionAnswer>;
  for (const key of expectedKeys) {
    const answer = validateAnswer(value.answers[key], request.questions[key]);
    if (!answer) throw new ProviderError("INVALID_PROVIDER_RESPONSE", false);
    answers[key] = answer;
  }

  const usage = normalizeUsage(value.usage);
  if (usage === null) throw new ProviderError("INVALID_PROVIDER_RESPONSE", false);
  return { model: value.model, answers, ...(usage ? { usage } : {}) };
}

async function readBoundedResponse(response: Response): Promise<unknown> {
  if (!response.body) throw new ProviderError("INVALID_PROVIDER_RESPONSE", false);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      totalBytes += item.value.byteLength;
      if (totalBytes > LIMITS.providerResponseBytes) {
        await reader.cancel().catch(() => undefined);
        throw new ProviderError("INVALID_PROVIDER_RESPONSE", false);
      }
      chunks.push(item.value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw new ProviderError("INVALID_PROVIDER_RESPONSE", false);
  }
}

export async function requestOpenRouterDecision(
  request: DecisionRequest,
  config: Extract<ProviderConfig, { ok: true }>,
  fetchImpl: typeof fetch = fetch,
): Promise<Pick<DecisionResponse, "model" | "answers" | "usage">> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    let response: Response;
    try {
      response = await fetchImpl(OPENROUTER_DECISIONS_URL, {
        method: "POST",
        redirect: "error",
        signal: controller.signal,
        headers: {
          authorization: "Bearer " + config.apiKey,
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({
          model: config.model,
          state: request.state,
          questions: request.questions,
        }),
      });
    } catch {
      throw new ProviderError(
        controller.signal.aborted ? "PROVIDER_TIMEOUT" : "PROVIDER_UNAVAILABLE",
        true,
      );
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      const retryable = response.status === 408 || response.status === 425
        || response.status === 429 || response.status >= 500;
      throw new ProviderError("PROVIDER_UNAVAILABLE", retryable);
    }
    const contentType = response.headers.get("content-type");
    if (contentType && !/^\s*application\/(?:[a-z0-9.+-]+\+)?json(?:\s*;|$)/i.test(contentType)) {
      throw new ProviderError("INVALID_PROVIDER_RESPONSE", false);
    }
    const payload = await readBoundedResponse(response);
    return validateProviderPayload(payload, request);
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    if (controller.signal.aborted) throw new ProviderError("PROVIDER_TIMEOUT", true);
    throw new ProviderError("PROVIDER_UNAVAILABLE", true);
  } finally {
    clearTimeout(timeout);
  }
}
