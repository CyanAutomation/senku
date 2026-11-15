import { describe, expect, it } from "vitest";
import { validateJsonSchema } from "../src/contracts/json-schema-validation";

describe("JSON Schema validation", () => {
  it("applies false schemas to object properties and array items", () => {
    expect(validateJsonSchema({ blocked: true }, {
      type: "object",
      properties: { blocked: false },
    })).toBe(false);
    expect(validateJsonSchema(["blocked"], {
      type: "array",
      items: false,
    })).toBe(false);
  });

  it("enforces alternatives by matching exactly one oneOf branch", () => {
    const schema = {
      oneOf: [
        { type: "string" },
        { const: "exact" },
      ],
    } as const;

    expect(validateJsonSchema("other", schema)).toBe(true);
    expect(validateJsonSchema("exact", schema)).toBe(false);
  });

  it("returns false for an invalid schema pattern instead of throwing", () => {
    expect(validateJsonSchema("value", { type: "string", pattern: "[" })).toBe(false);
  });
});
