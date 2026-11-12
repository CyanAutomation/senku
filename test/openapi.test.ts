import { describe, expect, it } from "vitest";
import { buildOpenApiDocument } from "../src/api/openapi";
import { getPublicProfileContract, listPublicProfiles } from "../src/api/profile-contracts";
import { PROFILE_CLIENT_PERMISSIONS, type ProfileId } from "../src/auth/permissions";
import { validateJsonSchema } from "../src/contracts/json-schema-validation";
import { profileRegistry } from "../src/decisions/profile-registry";

const inputs: Record<ProfileId, unknown> = {
  run_operations_triage_v1: { run: {
    status: "failed", stage: "validation", operationalHealth: "suspect_stalled", failureClass: "provider_failure",
    createdAt: "2026-11-08T12:00:00.000Z", queuedAt: "2026-11-08T12:00:01.000Z", startedAt: "2026-11-08T12:00:02.000Z",
    completedAt: "2026-11-08T12:00:03.000Z", lastHeartbeatAt: "2026-11-08T12:00:02.500Z",
  } },
  kaseki_output_review_v1: { canonicalRun: { status: "completed", failureClass: null, exitCode: 0, changedFileCount: 3 }, summary: "Implemented and validated." },
  kaseki_output_review_v2: { canonicalRun: { status: "completed", failureClass: null, exitCode: 0, changedFileCount: 3 }, summary: null },
  task_admission_v1: { repoUrl: "https://github.com/CyanAutomation/senku", taskPrompt: "Add the authenticated REST API." },
  kaseki_goal_check_v1: { state: { evidence: "bounded" }, criteria: [{ id: "criterion_1", criterion: "The goal is met." }] },
  kaseki_run_evaluation_v1: { state: { evidence: "bounded" }, includeFailureDiagnosis: false },
  kaseki_context_routing_v1: { mode: "tool_output", evidence: { phase: "coding", toolName: "bash", resultKind: "command_output", isError: false, characters: 1, bytes: 1, approximateTokens: 1, lineCount: 1, consecutiveDuplicateLineRatio: 0, hasReadRange: false } },
  validation_recovery_v1: { command: "npm test", exitCode: 1, output: "Assertion failed." },
};

function collectRefs(value: unknown, output: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) collectRefs(item, output);
  } else if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    if (typeof object.$ref === "string") output.push(object.$ref);
    for (const item of Object.values(object)) collectRefs(item, output);
  }
  return output;
}

describe("permission-filtered OpenAPI and profile schemas", () => {
  it("returns a structurally complete OpenAPI 3.1 document for each identity", () => {
    for (const identity of ["kaseki", "soyuz"] as const) {
      const document = buildOpenApiDocument(identity) as Record<string, unknown>;
      expect(document).toMatchObject({
        openapi: "3.1.0",
        info: { title: "Senku Decision API", version: "1" },
      });
      const paths = document.paths as Record<string, Record<string, unknown>>;
      expect(paths).toHaveProperty("/v1/profiles");
      expect(paths).toHaveProperty("/v1/profiles/{profileId}");
      expect(paths).toHaveProperty("/v1/profiles/{profileId}/evaluate");
      expect(paths).toHaveProperty("/openapi.json");
      expect(paths).toHaveProperty("/utcp");
      expect(paths).toHaveProperty("/healthz");
      expect(paths).toHaveProperty("/readyz");
      const profileEvaluation = (paths["/v1/profiles/{profileId}/evaluate"] as { post: { responses: Record<string, unknown> } }).post;
      expect(profileEvaluation.responses).toHaveProperty("405");
      expect(profileEvaluation.responses).toHaveProperty("415");
      expect((paths["/healthz"] as { get: { responses: Record<string, unknown> } }).get.responses).toHaveProperty("405");
      expect(paths).not.toHaveProperty("/v1/decisions");
      const schemas = (document.components as { schemas: Record<string, unknown> }).schemas;
      expect(schemas).not.toHaveProperty("DecisionRequest");
      expect(schemas).not.toHaveProperty("DecisionResponse");
      const components = document.components as { schemas: Record<string, unknown>; securitySchemes: Record<string, unknown> };
      expect(components.securitySchemes).toHaveProperty("BearerAuth");
      expect((paths["/v1/profiles"] as { get: { security: Array<Record<string, unknown>> } }).get.security).toEqual([{ BearerAuth: [] }]);
      expect((paths["/healthz"] as { get: { security: unknown[] } }).get.security).toEqual([]);
      for (const reference of collectRefs(document)) {
        expect(reference).toMatch(/^#\/components\/schemas\//);
        const name = reference.slice("#/components/schemas/".length);
        expect(components.schemas).toHaveProperty(name);
      }
      expect(JSON.stringify(document)).not.toContain("Does this run record warrant human follow-up now?");
      expect(JSON.stringify(document)).not.toMatch(/SENKU_(?:KASEKI|SOYUZ)_API_TOKEN|OPENROUTER_API_KEY/);
      expect(JSON.stringify(paths)).not.toMatch(/mcp/i);
    }
  });

  it("documents every profile contract only for identities permitted to use it", () => {
    const kasekiIds = listPublicProfiles("kaseki").map((item) => item.id);
    const soyuzIds = listPublicProfiles("soyuz").map((item) => item.id);
    expect(kasekiIds).toEqual(["task_admission_v1", "kaseki_goal_check_v1", "kaseki_run_evaluation_v1", "kaseki_context_routing_v1", "validation_recovery_v1"]);
    expect(soyuzIds).toEqual(["run_operations_triage_v1", "kaseki_output_review_v1", "kaseki_output_review_v2"]);
    expect(kasekiIds).not.toContain("run_operations_triage_v1");
    expect(soyuzIds).not.toContain("task_admission_v1");

    for (const id of [...kasekiIds, ...soyuzIds]) {
      const contract = getPublicProfileContract(id);
      const profile = profileRegistry.getProfile(id);
      expect(contract.inputSchema).toEqual(profile.inputSchema);
      expect(contract.outputSchema).toMatchObject(profile.dynamicQuestions
        ? { type: "object", additionalProperties: expect.any(Object) }
        : { type: "object", required: Object.keys(profile.questions) });
      expect(contract.limits.maxEvidenceBytes).toBe(profile.maxEvidenceBytes);
      expect(contract.questionCount).toBe(profile.maxQuestionCount ?? Object.keys(profile.questions).length);
      expect(PROFILE_CLIENT_PERMISSIONS[id as ProfileId]).toContain(profile.owner);
    }
  });

  it("keeps JSON schemas and handwritten runtime input validators in parity for all profiles", () => {
    for (const profile of profileRegistry.listProfiles()) {
      const implementation = profileRegistry.getProfile(profile.id);
      const value = inputs[profile.id as ProfileId];
      expect(validateJsonSchema(value, implementation.inputSchema)).toBe(true);
      expect(() => implementation.validateInput(value)).not.toThrow();
    }

    const review = profileRegistry.getProfile("kaseki_output_review_v1");
    const reviewBase = inputs.kaseki_output_review_v1 as { canonicalRun: Record<string, unknown>; summary: string };
    for (const exitCode of [-1, 0, 255]) {
      const candidate = { ...reviewBase, canonicalRun: { ...reviewBase.canonicalRun, exitCode } };
      expect(validateJsonSchema(candidate, review.inputSchema)).toBe(true);
      expect(() => review.validateInput(candidate)).not.toThrow();
    }
    for (const exitCode of [-2, 256]) {
      const candidate = { ...reviewBase, canonicalRun: { ...reviewBase.canonicalRun, exitCode } };
      expect(validateJsonSchema(candidate, review.inputSchema)).toBe(false);
      expect(() => review.validateInput(candidate)).toThrow();
    }

    const recovery = profileRegistry.getProfile("validation_recovery_v1");
    const recoveryBase = inputs.validation_recovery_v1 as { command: string; exitCode: number; output: string };
    const overBytes = { ...recoveryBase, output: "é".repeat(3_001) };
    expect(validateJsonSchema(overBytes, recovery.inputSchema)).toBe(false);
    expect(() => recovery.validateInput(overBytes)).toThrow();

    const taskAdmission = profileRegistry.getProfile("task_admission_v1");
    const taskBase = inputs.task_admission_v1 as Record<string, unknown>;
    const invalidUrls = [
      "ftp://github.com/CyanAutomation/senku",
      "https://user:password@github.com/CyanAutomation/senku",
      "https://github.com/CyanAutomation/senku?token=private",
      "https://github.com/CyanAutomation/senku#private",
    ];
    for (const repoUrl of invalidUrls) {
      const candidate = { ...taskBase, repoUrl };
      expect(validateJsonSchema(candidate, taskAdmission.inputSchema)).toBe(false);
      expect(() => taskAdmission.validateInput(candidate)).toThrow();
    }

    const tooFewUnicodeCharacters = { ...taskBase, taskPrompt: "😀".repeat(5) };
    expect(validateJsonSchema(tooFewUnicodeCharacters, taskAdmission.inputSchema)).toBe(false);
    expect(() => taskAdmission.validateInput(tooFewUnicodeCharacters)).toThrow();
    const tenUnicodeCharacters = { ...taskBase, taskPrompt: "😀".repeat(10) };
    expect(validateJsonSchema(tenUnicodeCharacters, taskAdmission.inputSchema)).toBe(true);
    expect(() => taskAdmission.validateInput(tenUnicodeCharacters)).not.toThrow();

    const reviewSummarySchema = profileRegistry.getProfile("kaseki_output_review_v1");
    const unicodeReviewBase = inputs.kaseki_output_review_v1 as Record<string, unknown>;
    const unicodeSummary = { ...unicodeReviewBase, summary: "😀".repeat(2_000) };
    expect(validateJsonSchema(unicodeSummary, reviewSummarySchema.inputSchema)).toBe(true);
    expect(() => reviewSummarySchema.validateInput(unicodeSummary)).not.toThrow();

    const blankCommand = { ...recoveryBase, command: "   " };
    expect(validateJsonSchema(blankCommand, recovery.inputSchema)).toBe(false);
    expect(() => recovery.validateInput(blankCommand)).toThrow();
  });

  it("documents nullable canonical confidence in dynamic profile answers", () => {
    const profile = getPublicProfileContract("kaseki_run_evaluation_v1");
    const canonical = (profile.outputSchema as { additionalProperties?: unknown }).additionalProperties as {
      oneOf: Array<{ properties: { confidence: { type: string | string[] } } }>;
    };
    expect(canonical.oneOf.map((answer) => answer.properties.confidence.type)).toEqual([
      "null", ["number", "null"], ["number", "null"],
    ]);
    const distribution = canonical.oneOf[1].properties as unknown as {
      probabilities: { "x-probabilitySum": number; "x-probabilityTolerance": number };
    };
    expect(distribution.probabilities).toMatchObject({ "x-probabilitySum": 1, "x-probabilityTolerance": 0.03 });
  });
});
