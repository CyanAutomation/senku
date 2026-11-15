import { LIMITS } from "../contracts/decisions";
import { ProfileEngineError } from "../contracts/profiles";
import { isPlainRecord } from "../contracts/records";

// Stop at PEM delimiters so unmatched headers cannot scan through later key blocks.
const PEM_PRIVATE_KEY_BLOCK = /-----BEGIN [^-]+ PRIVATE KEY-----[^-]*(?:-(?!-{4})[^-]*)*-----END [^-]+ PRIVATE KEY-----/g;

function isBoundedJson(value: unknown, budget: { nodes: number }, depth: number): boolean {
  budget.nodes += 1;
  if (budget.nodes > LIMITS.contentNodes || depth > Math.min(LIMITS.contentDepth, 12)) return false;
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((item) => isBoundedJson(item, budget, depth + 1));
  if (!isPlainRecord(value)) return false;
  return Object.values(value).every((item) => isBoundedJson(item, budget, depth + 1));
}

export function requireBoundedJsonObject(value: unknown, maxBytes: number): Record<string, unknown> {
  if (!isPlainRecord(value) || Object.keys(value).length === 0
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
      .replace(PEM_PRIVATE_KEY_BLOCK, "[REDACTED_PRIVATE_KEY]")
      .replace(/\bAuthorization\s*:\s*Bearer\s+[^\s,;]+/gi, "Authorization: Bearer [REDACTED_CREDENTIAL]")
      .replace(/\bBearer\s+[A-Za-z0-9._~+/-]{16,}/g, "Bearer [REDACTED_CREDENTIAL]")
      .replace(/\bAKIA[A-Z0-9]{16}\b/g, "[REDACTED_CREDENTIAL]")
      .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[REDACTED_CREDENTIAL]")
      .replace(/(https?:\/\/[^:\/\s]+):([^@/\s]+)@/gi, "$1:[REDACTED_CREDENTIAL]@")
      .replace(/\b(sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]{12,}|xox[baprs]-[A-Za-z0-9-]{12,})\b/g, "[REDACTED_CREDENTIAL]")
      .replace(/(password|passwd|secret|token|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED_SECRET]");
  }
  if (Array.isArray(value)) return value.map(redactKasekiEvidence);
  if (isPlainRecord(value)) {
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
