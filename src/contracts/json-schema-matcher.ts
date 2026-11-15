import type { JsonSchema } from "./profiles";
import { matchesCombinations, matchesContent } from "./json-schema-rules";

const typeMatchers: Record<string, (value: unknown) => boolean> = {
  null: (value) => value === null,
  object: (value) => Boolean(value && typeof value === "object" && !Array.isArray(value)),
  array: Array.isArray,
  string: (value) => typeof value === "string",
  integer: (value) => typeof value === "number" && Number.isSafeInteger(value),
  number: (value) => typeof value === "number" && Number.isFinite(value),
  boolean: (value) => typeof value === "boolean",
};

function matchesDeclaredTypes(value: unknown, schema: Exclude<JsonSchema, boolean>): boolean {
  if (schema.type === undefined) return true;
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  return types.some((type) => typeMatchers[type]?.(value) ?? false);
}

function matchesLiteralConstraints(value: unknown, schema: Exclude<JsonSchema, boolean>): boolean {
  if (schema.const !== undefined && !Object.is(value, schema.const)) return false;
  return !schema.enum || schema.enum.some((item) => Object.is(value, item));
}

export function matchesJsonSchema(value: unknown, schema: JsonSchema): boolean {
  if (typeof schema === "boolean") return schema;
  return matchesLiteralConstraints(value, schema)
    && matchesDeclaredTypes(value, schema)
    && matchesContent(value, schema, matchesJsonSchema)
    && matchesCombinations(value, schema, matchesJsonSchema);
}
