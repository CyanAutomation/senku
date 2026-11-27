import {
  LIMITS,
  type ChoiceAnswer,
  type ChoiceQuestion,
  type DecisionAnswer,
  type DecisionQuestion,
  type DecisionRequest,
  type NoulAnswer,
  type ProviderUsage,
  type ScoreAnswer,
  type ScoreQuestion,
} from "../../contracts/decisions";
import { ProviderError } from "./config";

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

function expectedScoreLegend(question: ScoreQuestion): Record<string, string> {
  return Object.fromEntries(question.criteria.map((criterion, index) => [
    String(index),
    typeof criterion === "string" ? criterion : JSON.stringify(criterion),
  ]));
}

function hasExactKeys(value: Record<string, unknown>, expectedKeys: string[]): boolean {
  const actualKeys = Object.keys(value);
  return actualKeys.length === expectedKeys.length && expectedKeys.every((key) => Object.hasOwn(value, key));
}

function isValidScoreLegendEntry(value: unknown, criterion: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || Array.from(value).length > 1_000) return false;
  return typeof criterion !== "string" || value === criterion;
}

function validScoreLegend(value: unknown, question: ScoreQuestion, expectedKeys: string[]): Record<string, string> | null {
  if (value === undefined) return expectedScoreLegend(question);
  if (!isRecord(value) || !hasExactKeys(value, expectedKeys)) return null;
  const matchesDeclaredScale = expectedKeys.every((key) =>
    isValidScoreLegendEntry(value[key], question.criteria[Number(key)]));
  return matchesDeclaredScale ? value as Record<string, string> : null;
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

function hasValidScoreShape(value: unknown, question: ScoreQuestion): value is Record<string, unknown> {
  return isRecord(value)
    && hasOnlyKeys(value, ["type", "score", "legend", "probabilities", "confidence"])
    && value.type === "score"
    && typeof value.score === "number"
    && Number.isFinite(value.score)
    && value.score >= 0
    && value.score <= question.criteria.length - 1;
}

function scoreAnswerMetadata(
  value: Record<string, unknown>,
  question: ScoreQuestion,
  scoreKeys: string[],
): { legend: Record<string, string>; confidence: number | null } | null {
  const legend = validScoreLegend(value.legend, question, scoreKeys);
  const confidence = optionalConfidence(value.confidence);
  return !legend || confidence === undefined ? null : { legend, confidence };
}

function validateScoreAnswer(value: unknown, question: ScoreQuestion): ScoreAnswer | null {
  if (!hasValidScoreShape(value, question)) return null;
  const scoreKeys = question.criteria.map((_criterion, index) => String(index));
  if (!isExactDistribution(value.probabilities, scoreKeys)) return null;
  const metadata = scoreAnswerMetadata(value, question, scoreKeys);
  if (!metadata) return null;
  return {
    type: "score",
    score: value.score as number,
    legend: metadata.legend,
    probabilities: value.probabilities,
    confidence: metadata.confidence,
  };
}

function validateAnswer(value: unknown, question: DecisionQuestion): DecisionAnswer | null {
  if (!isRecord(value) || value.type !== question.type) return null;
  if (question.type === "noul") return validateNoulAnswer(value);
  if (question.type === "choice") return validateChoiceAnswer(value, question);
  return validateScoreAnswer(value, question);
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isNonNegativeFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function normalizeUsage(value: unknown): ProviderUsage | undefined {
  if (!isRecord(value)) return undefined;
  const result: ProviderUsage = {};
  for (const key of ["input_tokens", "output_tokens", "total_tokens"] as const) {
    if (value[key] === undefined) continue;
    if (isNonNegativeSafeInteger(value[key])) result[key] = value[key];
  }
  if (isNonNegativeFiniteNumber(value.cost)) result.cost = value.cost;
  return Object.keys(result).length > 0 ? result : undefined;
}

export function validateProviderPayload(value: unknown, request: DecisionRequest): {
  model: string;
  answers: Record<string, DecisionAnswer>;
  usage?: ProviderUsage;
} {
  if (!isRecord(value) || !isRecord(value.answers)) {
    throw new ProviderError("INVALID_PROVIDER_RESPONSE", false, { diagnosticCode: "response_envelope_invalid" });
  }
  if (typeof value.model !== "string" || value.model.trim().length === 0 || value.model.length > 200) {
    throw new ProviderError("INVALID_PROVIDER_RESPONSE", false, { diagnosticCode: "response_model_invalid" });
  }

  const expectedKeys = Object.keys(request.questions);
  const answerKeys = Object.keys(value.answers);
  if (expectedKeys.length !== answerKeys.length
    || !expectedKeys.every((key) => Object.hasOwn(value.answers as object, key))) {
    throw new ProviderError("INVALID_PROVIDER_RESPONSE", false, { diagnosticCode: "response_answer_set_mismatch" });
  }
  const answers: Record<string, DecisionAnswer> = Object.create(null) as Record<string, DecisionAnswer>;
  for (const key of expectedKeys) {
    const answer = validateAnswer(value.answers[key], request.questions[key]);
    if (!answer) throw new ProviderError("INVALID_PROVIDER_RESPONSE", false, { diagnosticCode: "response_answer_invalid" });
    answers[key] = answer;
  }

  const usage = normalizeUsage(value.usage);
  return { model: value.model, answers, ...(usage ? { usage } : {}) };
}

export async function readBoundedResponse(response: Response): Promise<unknown> {
  if (!response.body) throw new ProviderError("INVALID_PROVIDER_RESPONSE", false, { diagnosticCode: "response_body_missing" });
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
        throw new ProviderError("INVALID_PROVIDER_RESPONSE", false, { diagnosticCode: "response_body_too_large" });
      }
      chunks.push(item.value);
    }
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    throw new ProviderError("PROVIDER_UNAVAILABLE", true, { diagnosticCode: "response_body_read_failed" });
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
    throw new ProviderError("INVALID_PROVIDER_RESPONSE", false, { diagnosticCode: "response_body_invalid_json" });
  }
}
