import {
  LIMITS,
  SCHEMA_VERSION,
  type DecisionQuestion,
  type DecisionRequest,
  type JevContent,
  type JsonObject,
  type JsonValue,
} from "./decisions";

export type RequestValidation =
  | { ok: true; value: DecisionRequest }
  | { ok: false; code: "INVALID_REQUEST" | "UNSUPPORTED_SCHEMA_VERSION" };

const identifierPattern = /^[a-z][a-z0-9_]{0,63}$/;
const identifierKeys = (value: Record<string, unknown>): boolean =>
  Object.keys(value).every((key) => identifierPattern.test(key));

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

interface NodeBudget {
  count: number;
}

function isJsonTree(value: unknown, budget: NodeBudget): value is JsonValue {
  const stack: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  while (stack.length > 0) {
    const current = stack.pop()!;
    budget.count += 1;
    if (budget.count > LIMITS.contentNodes || current.depth > LIMITS.contentDepth) return false;
    const item = current.value;
    if (item === null || typeof item === "string" || typeof item === "boolean") continue;
    if (typeof item === "number") {
      if (!Number.isFinite(item)) return false;
      continue;
    }
    if (Array.isArray(item)) {
      for (const child of item) stack.push({ value: child, depth: current.depth + 1 });
      continue;
    }
    if (!isRecord(item)) return false;
    for (const child of Object.values(item)) stack.push({ value: child, depth: current.depth + 1 });
  }
  return true;
}

function isJevContent(value: unknown, budget: NodeBudget): value is JevContent {
  if (typeof value === "string") {
    return value.trim().length > 0 && new TextEncoder().encode(value).byteLength <= LIMITS.instructionBytes;
  }
  if (!Array.isArray(value) && !isRecord(value)) return false;
  if (Array.isArray(value) ? value.length === 0 : Object.keys(value).length === 0) return false;
  return isJsonTree(value, budget);
}

function isQuestion(value: unknown, budget: NodeBudget): value is DecisionQuestion {
  if (!isRecord(value) || typeof value.type !== "string" || !hasOnlyKeys(value, ["type", "instructions", "criteria"])) {
    return false;
  }
  if (!isJevContent(value.instructions, budget)) return false;

  if (value.type === "noul") {
    const criteria = value.criteria;
    if (criteria === undefined) return true;
    if (!isRecord(criteria) || !hasOnlyKeys(criteria, ["true", "false"])) return false;
    const keys = Object.keys(criteria);
    return keys.length > 0
      && keys.every((key) => isJevContent(criteria[key], budget));
  }

  if (value.type === "choice") {
    const criteria = value.criteria;
    if (!isRecord(criteria)) return false;
    const keys = Object.keys(criteria);
    return keys.length >= 2
      && keys.length <= LIMITS.optionsPerQuestion
      && identifierKeys(criteria)
      && keys.every((key) => criteria[key] === null || isJevContent(criteria[key], budget));
  }

  if (value.type === "score") {
    if (!Array.isArray(value.criteria) || value.criteria.length < 2 || value.criteria.length > LIMITS.optionsPerQuestion) {
      return false;
    }
    return value.criteria.every((item) => isJevContent(item, budget));
  }

  return false;
}

export function validateDecisionRequest(value: unknown): RequestValidation {
  if (!isRecord(value)) return { ok: false, code: "INVALID_REQUEST" };
  if (typeof value.schemaVersion === "string" && value.schemaVersion !== SCHEMA_VERSION) {
    return { ok: false, code: "UNSUPPORTED_SCHEMA_VERSION" };
  }
  if (!hasOnlyKeys(value, ["schemaVersion", "state", "questions"])
    || value.schemaVersion !== SCHEMA_VERSION
    || (typeof value.state !== "string" && !isRecord(value.state))) {
    return { ok: false, code: "INVALID_REQUEST" };
  }

  const budget: NodeBudget = { count: 0 };
  if (typeof value.state === "string") {
    if (!value.state.trim() || new TextEncoder().encode(value.state).byteLength > LIMITS.requestBytes) {
      return { ok: false, code: "INVALID_REQUEST" };
    }
  } else if (!isJsonTree(value.state, budget)) {
    return { ok: false, code: "INVALID_REQUEST" };
  }

  const questions = value.questions;
  if (!isRecord(questions)) return { ok: false, code: "INVALID_REQUEST" };
  const questionIds = Object.keys(questions);
  if (questionIds.length < 1 || questionIds.length > LIMITS.questions
    || !identifierKeys(questions)
    || !questionIds.every((key) => isQuestion(questions[key], budget))) {
    return { ok: false, code: "INVALID_REQUEST" };
  }

  return { ok: true, value: value as unknown as DecisionRequest };
}

export function isRequestObject(value: unknown): value is Record<string, unknown> {
  return isRecord(value);
}

export function isJsonObject(value: unknown): value is JsonObject {
  return isRecord(value);
}
