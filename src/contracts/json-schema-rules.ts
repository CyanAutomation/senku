import type { JsonSchema } from "./profiles";

type ObjectSchema = Exclude<JsonSchema, boolean>;
export type SchemaMatcher = (value: unknown, schema: JsonSchema) => boolean;

function matchesUriProtocol(url: URL, schema: ObjectSchema): boolean {
  const allowedProtocols = schema["x-allowedProtocols"];
  return !Array.isArray(allowedProtocols)
    || (allowedProtocols.every((protocol) => typeof protocol === "string")
      && allowedProtocols.includes(url.protocol));
}

function matchesUriRestrictions(url: URL, schema: ObjectSchema): boolean {
  return !(schema["x-disallowUserInfo"] === true && (url.username || url.password))
    && !(schema["x-disallowQuery"] === true && url.search)
    && !(schema["x-disallowFragment"] === true && url.hash);
}

function matchesUri(value: string, schema: ObjectSchema): boolean {
  try {
    const url = new URL(value);
    return Boolean(url.hostname) && matchesUriProtocol(url, schema) && matchesUriRestrictions(url, schema);
  } catch {
    return false;
  }
}

function matchesStringLength(value: string, schema: ObjectSchema): boolean {
  const characters = Array.from(value).length;
  const bytes = new TextEncoder().encode(value).byteLength;
  return !(schema.minLength !== undefined && characters < schema.minLength)
    && !(schema.maxLength !== undefined && characters > schema.maxLength)
    && !(typeof schema["x-maxBytes"] === "number" && bytes > schema["x-maxBytes"]);
}

function matchesStringFormat(value: string, schema: ObjectSchema): boolean {
  if (schema.pattern && !new RegExp(schema.pattern).test(value)) return false;
  if (schema.format === "date-time") {
    return /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));
  }
  return schema.format !== "uri" || matchesUri(value, schema);
}

function matchesString(value: string, schema: ObjectSchema): boolean {
  return matchesStringLength(value, schema) && matchesStringFormat(value, schema);
}

function matchesNumber(value: number, schema: ObjectSchema): boolean {
  return !(schema.minimum !== undefined && value < schema.minimum)
    && !(schema.maximum !== undefined && value > schema.maximum);
}

function matchesArray(value: unknown[], schema: ObjectSchema, matches: SchemaMatcher): boolean {
  if (schema.minItems !== undefined && value.length < schema.minItems) return false;
  if (schema.maxItems !== undefined && value.length > schema.maxItems) return false;
  return schema.items === undefined || value.every((item) => matches(item, schema.items!));
}

function matchesObjectSize(value: Record<string, unknown>, schema: ObjectSchema): boolean {
  const keys = Object.keys(value);
  return !(schema.minProperties !== undefined && keys.length < schema.minProperties)
    && !(schema.maxProperties !== undefined && keys.length > schema.maxProperties)
    && !(schema.required ?? []).some((key) => !Object.hasOwn(value, key));
}

function matchesObjectProperties(value: Record<string, unknown>, schema: ObjectSchema, matches: SchemaMatcher): boolean {
  for (const [key, item] of Object.entries(value)) {
    const propertySchema = schema.properties?.[key];
    const allowedByProperty = propertySchema !== undefined && matches(item, propertySchema);
    if (propertySchema !== undefined) {
      if (!allowedByProperty) return false;
    } else if (schema.additionalProperties !== undefined && !matches(item, schema.additionalProperties)) {
      return false;
    }
  }
  return true;
}

function matchesObject(value: Record<string, unknown>, schema: ObjectSchema, matches: SchemaMatcher): boolean {
  return matchesObjectSize(value, schema) && matchesObjectProperties(value, schema, matches);
}

export function matchesContent(value: unknown, schema: ObjectSchema, matches: SchemaMatcher): boolean {
  if (typeof value === "string") return matchesString(value, schema);
  if (typeof value === "number") return matchesNumber(value, schema);
  if (Array.isArray(value)) return matchesArray(value, schema, matches);
  if (value && typeof value === "object") return matchesObject(value as Record<string, unknown>, schema, matches);
  return true;
}

export function matchesCombinations(value: unknown, schema: ObjectSchema, matches: SchemaMatcher): boolean {
  if (schema.anyOf && !schema.anyOf.some((item) => matches(value, item))) return false;
  return !schema.oneOf || schema.oneOf.filter((item) => matches(value, item)).length === 1;
}
