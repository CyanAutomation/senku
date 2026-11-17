import { describe, expect, it } from "vitest";
import { profileRegistry } from "../src/decisions/profile-registry";
import { validateJsonSchema } from "../src/contracts/json-schema-validation";

describe("JSON Schema validation", () => {
  it("rejects an object property constrained by a false schema", () => {
    expect(validateJsonSchema({ blocked: true }, {
      type: "object",
      properties: { blocked: false },
    })).toBe(false);
  });

  it("rejects array items constrained by a false schema", () => {
    expect(validateJsonSchema(["blocked"], {
      type: "array",
      items: false,
    })).toBe(false);
  });

  it("requires exactly one matching oneOf branch", () => {
    const schema = {
      oneOf: [
        { type: "string" },
        { const: "exact" },
      ],
    } as const;

    expect(validateJsonSchema("other", schema)).toBe(true);
    expect(validateJsonSchema("exact", schema)).toBe(false);
  });
});

describe("profile input JSON Schema validation", () => {
  // Contract: docs/CONTRACT.md#profile-evaluation; caller input cannot add undeclared fields.
  it("rejects undeclared fields at the root and nested run object", () => {
    const profile = profileRegistry.getProfile("run_operations_triage_v1");
    const validInput = {
      run: {
        status: "failed",
        stage: "validation",
        operationalHealth: "suspect_stalled",
        failureClass: "provider_failure",
        createdAt: "2026-11-08T12:00:00.000Z",
        queuedAt: "2026-11-08T12:00:01.000Z",
        startedAt: "2026-11-08T12:00:02.000Z",
        completedAt: "2026-11-08T12:00:03.000Z",
        lastHeartbeatAt: "2026-11-08T12:00:02.500Z",
      },
    };

    expect(validateJsonSchema(validInput, profile.inputSchema)).toBe(true);
    expect(validateJsonSchema({ ...validInput, callerQuestions: { q: "override" } }, profile.inputSchema)).toBe(false);
    expect(validateJsonSchema({
      ...validInput,
      run: { ...validInput.run, callerIdentity: "soyuz" },
    }, profile.inputSchema)).toBe(false);
  });
});
