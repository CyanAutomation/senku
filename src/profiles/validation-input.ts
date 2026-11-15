import { ProfileEngineError } from "../contracts/profiles";
import { isPlainRecord } from "../contracts/records";

export function requireRecord(value: unknown): Record<string, unknown> {
  if (!isPlainRecord(value)) throw new ProfileEngineError("INVALID_PROFILE_INPUT");
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

function requireInteger(value: unknown, min: number, max: number): number {
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

function requireStringArray(value: unknown, maxItems: number, maxItemBytes: number): string[] {
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
