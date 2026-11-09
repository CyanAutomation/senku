import type { JsonSchema } from "./profiles";

function valueMatchesType(value: unknown, type: string): boolean {
  switch (type) {
    case "null": return value === null;
    case "object": return Boolean(value && typeof value === "object" && !Array.isArray(value));
    case "array": return Array.isArray(value);
    case "string": return typeof value === "string";
    case "integer": return typeof value === "number" && Number.isSafeInteger(value);
    case "number": return typeof value === "number" && Number.isFinite(value);
    case "boolean": return typeof value === "boolean";
    default: return false;
  }
}

function matches(value: unknown, schema: JsonSchema): boolean {
  if (typeof schema === "boolean") return schema;
  if (schema.const !== undefined && !Object.is(value, schema.const)) return false;
  if (schema.enum && !schema.enum.some((item) => Object.is(value, item))) return false;

  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((type) => valueMatchesType(value, type))) return false;
  }

  if (typeof value === "string") {
    const characters = Array.from(value).length;
    const bytes = new TextEncoder().encode(value).byteLength;
    if (schema.minLength !== undefined && characters < schema.minLength) return false;
    if (schema.maxLength !== undefined && characters > schema.maxLength) return false;
    if (typeof schema["x-maxBytes"] === "number" && bytes > schema["x-maxBytes"]) return false;
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) return false;
    if (schema.format === "date-time" && (!/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(Date.parse(value)))) return false;
    if (schema.format === "uri") {
      try {
        const url = new URL(value);
        if (!url.hostname) return false;
        const allowedProtocols = schema["x-allowedProtocols"];
        if (Array.isArray(allowedProtocols)
          && (!allowedProtocols.every((protocol) => typeof protocol === "string")
            || !allowedProtocols.includes(url.protocol))) return false;
        if (schema["x-disallowUserInfo"] === true && (url.username || url.password)) return false;
        if (schema["x-disallowQuery"] === true && url.search) return false;
        if (schema["x-disallowFragment"] === true && url.hash) return false;
      } catch {
        return false;
      }
    }
  }

  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) return false;
    if (schema.maximum !== undefined && value > schema.maximum) return false;
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) return false;
    if (schema.maxItems !== undefined && value.length > schema.maxItems) return false;
    if (schema.items && !value.every((item) => matches(item, schema.items!))) return false;
  }

  if (value && typeof value === "object" && !Array.isArray(value)) {
    const object = value as Record<string, unknown>;
    if (schema.minProperties !== undefined && Object.keys(object).length < schema.minProperties) return false;
    if (schema.maxProperties !== undefined && Object.keys(object).length > schema.maxProperties) return false;
    for (const key of schema.required ?? []) {
      if (!Object.hasOwn(object, key)) return false;
    }
    for (const [key, item] of Object.entries(object)) {
      const propertySchema = schema.properties?.[key];
      if (propertySchema) {
        if (!matches(item, propertySchema)) return false;
      } else if (schema.additionalProperties === false) {
        return false;
      } else if (schema.additionalProperties && !matches(item, schema.additionalProperties)) {
        return false;
      }
    }
  }

  if (schema.anyOf && !schema.anyOf.some((item) => matches(value, item))) return false;
  if (schema.oneOf && schema.oneOf.filter((item) => matches(value, item)).length !== 1) return false;
  return true;
}

export function validateJsonSchema(value: unknown, schema: JsonSchema): boolean {
  try {
    return matches(value, schema);
  } catch {
    return false;
  }
}
