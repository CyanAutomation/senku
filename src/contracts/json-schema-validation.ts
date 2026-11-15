import type { JsonSchema } from "./profiles";
import { matchesJsonSchema } from "./json-schema-matcher";

export function validateJsonSchema(value: unknown, schema: JsonSchema): boolean {
  try {
    return matchesJsonSchema(value, schema);
  } catch {
    return false;
  }
}
