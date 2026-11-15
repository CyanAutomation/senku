import {
  LIMITS,
  SCHEMA_VERSION,
  type DecisionQuestion,
  type DecisionRequest,
  type JevContent,
  type JsonValue,
} from "./decisions";
import { isPlainRecord } from "./records";

export type RequestValidation =
  | { ok: true; value: DecisionRequest }
  | { ok: false; code: "INVALID_REQUEST" | "UNSUPPORTED_SCHEMA_VERSION" };

const identifierPattern = /^[a-z][a-z0-9_]{0,63}$/;
const identifierKeys = (value: Record<string, unknown>): boolean =>
  Object.keys(value).every((key) => identifierPattern.test(key));

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

interface NodeBudget {
  count: number;
}

function isJsonPrimitive(value: unknown): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  return typeof value === "number" && Number.isFinite(value);
}

function jsonChildren(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value;
  if (isPlainRecord(value)) return Object.values(value);
  return null;
}

function isJsonTree(value: unknown, budget: NodeBudget): value is JsonValue {
  const stack: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  while (stack.length > 0) {
    const current = stack.pop()!;
    budget.count += 1;
    if (budget.count > LIMITS.contentNodes || current.depth > LIMITS.contentDepth) return false;
    const item = current.value;
    if (isJsonPrimitive(item)) continue;
    const children = jsonChildren(item);
    if (children === null) return false;
    for (const child of children) stack.push({ value: child, depth: current.depth + 1 });
  }
  return true;
}

function isJevContent(value: unknown, budget: NodeBudget): value is JevContent {
  if (typeof value === "string") {
    return value.trim().length > 0 && new TextEncoder().encode(value).byteLength <= LIMITS.instructionBytes;
  }
  if (!Array.isArray(value) && !isPlainRecord(value)) return false;
  if (Array.isArray(value) ? value.length === 0 : Object.keys(value).length === 0) return false;
  return isJsonTree(value, budget);
}

function isNoulQuestionCriteria(value: unknown, budget: NodeBudget): boolean {
  if (value === undefined) return true;
  if (!isPlainRecord(value) || !hasOnlyKeys(value, ["true", "false"])) return false;
  const keys = Object.keys(value);
  return keys.length > 0 && keys.every((key) => isJevContent(value[key], budget));
}

function isChoiceQuestionCriteria(value: unknown, budget: NodeBudget): boolean {
  if (!isPlainRecord(value)) return false;
  const keys = Object.keys(value);
  return keys.length >= 2
    && keys.length <= LIMITS.optionsPerQuestion
    && identifierKeys(value)
    && keys.every((key) => value[key] === null || isJevContent(value[key], budget));
}

function isScoreQuestionCriteria(value: unknown, budget: NodeBudget): boolean {
  return Array.isArray(value)
    && value.length >= 2
    && value.length <= LIMITS.optionsPerQuestion
    && value.every((item) => isJevContent(item, budget));
}

function isQuestion(value: unknown, budget: NodeBudget): value is DecisionQuestion {
  if (!isPlainRecord(value) || typeof value.type !== "string"
    || !hasOnlyKeys(value, ["type", "instructions", "criteria"])
    || !isJevContent(value.instructions, budget)) return false;

  switch (value.type) {
    case "noul": return isNoulQuestionCriteria(value.criteria, budget);
    case "choice": return isChoiceQuestionCriteria(value.criteria, budget);
    case "score": return isScoreQuestionCriteria(value.criteria, budget);
    default: return false;
  }
}

export function validateDecisionRequest(value: unknown): RequestValidation {
  if (!isPlainRecord(value)) return { ok: false, code: "INVALID_REQUEST" };
  if (typeof value.schemaVersion === "string" && value.schemaVersion !== SCHEMA_VERSION) {
    return { ok: false, code: "UNSUPPORTED_SCHEMA_VERSION" };
  }
  if (!hasOnlyKeys(value, ["schemaVersion", "state", "questions"])
    || value.schemaVersion !== SCHEMA_VERSION
    || (typeof value.state !== "string" && !isPlainRecord(value.state))) {
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
  if (!isPlainRecord(questions)) return { ok: false, code: "INVALID_REQUEST" };
  const questionIds = Object.keys(questions);
  if (questionIds.length < 1 || questionIds.length > LIMITS.questions
    || !identifierKeys(questions)
    || !questionIds.every((key) => isQuestion(questions[key], budget))) {
    return { ok: false, code: "INVALID_REQUEST" };
  }

  return { ok: true, value: value as unknown as DecisionRequest };
}
