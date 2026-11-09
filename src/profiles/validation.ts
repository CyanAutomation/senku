import { LIMITS, type DecisionAnswer, type DecisionQuestion } from "../contracts/decisions";
import type { AnswersFor, ProfileQuestions } from "../contracts/profiles";
import { ProfileEngineError } from "../contracts/profiles";

export function isRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function requireRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new ProfileEngineError("INVALID_PROFILE_INPUT");
  return value;
}

export function requireOnlyKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  required: readonly string[] = [],
): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))
    || required.some((key) => !Object.hasOwn(value, key))) {
    throw new ProfileEngineError("INVALID_PROFILE_INPUT");
  }
}

export function requireString(
  value: unknown,
  maxBytes: number,
  options: { minCharacters?: number; allowEmpty?: boolean } = {},
): string {
  if (typeof value !== "string"
    || (!options.allowEmpty && !value.trim())
    || Array.from(value).length < (options.minCharacters ?? 0)
    || new TextEncoder().encode(value).byteLength > maxBytes) {
    throw new ProfileEngineError("INVALID_PROFILE_INPUT");
  }
  return value;
}

export function requireNullableString(value: unknown, maxBytes: number): string | null {
  return value === null ? null : requireString(value, maxBytes);
}

export function requireInteger(value: unknown, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) {
    throw new ProfileEngineError("INVALID_PROFILE_INPUT");
  }
  return value as number;
}

export function requireNullableInteger(value: unknown, min: number, max: number): number | null {
  return value === null ? null : requireInteger(value, min, max);
}

export function requireEnum<const Values extends readonly string[]>(
  value: unknown,
  values: Values,
): Values[number] {
  if (typeof value !== "string" || !values.includes(value)) {
    throw new ProfileEngineError("INVALID_PROFILE_INPUT");
  }
  return value as Values[number];
}

export function requireOptionalEnum<const Values extends readonly string[]>(
  value: unknown,
  values: Values,
): Values[number] | undefined {
  return value === undefined ? undefined : requireEnum(value, values);
}

export function requireStringArray(value: unknown, maxItems: number, maxItemBytes: number): string[] {
  if (!Array.isArray(value) || value.length > maxItems) {
    throw new ProfileEngineError("INVALID_PROFILE_INPUT");
  }
  return value.map((item) => requireString(item, maxItemBytes));
}

export function requireOptionalStringArray(
  value: unknown,
  maxItems: number,
  maxItemBytes: number,
): string[] | undefined {
  return value === undefined ? undefined : requireStringArray(value, maxItems, maxItemBytes);
}

function isBoundedJson(value: unknown, budget: { nodes: number }, depth: number): boolean {
  budget.nodes += 1;
  if (budget.nodes > LIMITS.contentNodes || depth > Math.min(LIMITS.contentDepth, 12)) return false;
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((item) => isBoundedJson(item, budget, depth + 1));
  if (!isRecord(value)) return false;
  return Object.values(value).every((item) => isBoundedJson(item, budget, depth + 1));
}

export function requireBoundedJsonObject(value: unknown, maxBytes: number): Record<string, unknown> {
  if (!isRecord(value) || Object.keys(value).length === 0
    || !isBoundedJson(value, { nodes: 0 }, 0)) {
    throw new ProfileEngineError("INVALID_PROFILE_INPUT");
  }
  let size: number;
  try {
    size = new TextEncoder().encode(JSON.stringify(value)).byteLength;
  } catch {
    throw new ProfileEngineError("INVALID_PROFILE_INPUT");
  }
  if (size > maxBytes) throw new ProfileEngineError("INVALID_PROFILE_INPUT");
  return value;
}

export function validateAnswersForQuestions<const Questions extends ProfileQuestions>(
  value: unknown,
  questions: Questions,
): AnswersFor<Questions> {
  if (!isRecord(value)) throw new ProfileEngineError("INVALID_PROFILE_OUTPUT");
  const expectedKeys = Object.keys(questions);
  const answerKeys = Object.keys(value);
  if (expectedKeys.length !== answerKeys.length
    || !expectedKeys.every((key) => Object.hasOwn(value, key))) {
    throw new ProfileEngineError("INVALID_PROFILE_OUTPUT");
  }
  for (const key of expectedKeys) {
    const question = questions[key] as DecisionQuestion;
    const answer = value[key] as DecisionAnswer;
    if (!answer || typeof answer !== "object" || answer.type !== question.type) {
      throw new ProfileEngineError("INVALID_PROFILE_OUTPUT");
    }
    if (question.type === "choice") {
      if (answer.type !== "choice" || typeof answer.choice !== "string"
        || !Object.hasOwn(question.criteria, answer.choice)) {
        throw new ProfileEngineError("INVALID_PROFILE_OUTPUT");
      }
    }
    if (question.type === "score") {
      if (answer.type !== "score" || typeof answer.score !== "number" || !Number.isFinite(answer.score)
        || answer.score < 0 || answer.score > question.criteria.length - 1) {
        throw new ProfileEngineError("INVALID_PROFILE_OUTPUT");
      }
    }
  }
  return value as AnswersFor<Questions>;
}

export function jsonState(value: unknown): string {
  try {
    const state = JSON.stringify(value);
    if (typeof state !== "string") throw new Error("State is not serializable.");
    return state;
  } catch {
    throw new ProfileEngineError("INVALID_PROFILE_INPUT");
  }
}

export function redactKasekiEvidence(value: unknown): unknown {
  if (typeof value === "string") {
    return value
      .replace(/-----BEGIN [^-]+ PRIVATE KEY-----[\s\S]*?-----END [^-]+ PRIVATE KEY-----/g, "[REDACTED_PRIVATE_KEY]")
      .replace(/\bAuthorization\s*:\s*Bearer\s+[^\s,;]+/gi, "Authorization: Bearer [REDACTED_CREDENTIAL]")
      .replace(/\bBearer\s+[A-Za-z0-9._~+/-]{16,}/g, "Bearer [REDACTED_CREDENTIAL]")
      .replace(/\bAKIA[A-Z0-9]{16}\b/g, "[REDACTED_CREDENTIAL]")
      .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[REDACTED_CREDENTIAL]")
      .replace(/(https?:\/\/[^:\/\s]+):([^@/\s]+)@/gi, "$1:[REDACTED_CREDENTIAL]@")
      .replace(/\b(sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]{12,}|xox[baprs]-[A-Za-z0-9-]{12,})\b/g, "[REDACTED_CREDENTIAL]")
      .replace(/(password|passwd|secret|token|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED_SECRET]");
  }
  if (Array.isArray(value)) return value.map(redactKasekiEvidence);
  if (isRecord(value)) {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      result[key] = /secret|token|password|credential|api.?key/i.test(key)
        ? "[REDACTED_SECRET]"
        : redactKasekiEvidence(item);
    }
    return result;
  }
  return value;
}
