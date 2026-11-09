import { createConfig, lintFromString } from "@redocly/openapi-core";
import { describe, expect, it } from "vitest";
import { buildOpenApiDocument } from "../src/api/openapi";

describe("independent OpenAPI 3.1 validation", () => {
  it("validates the full permission-filtered documents offline with Redocly", async () => {
    const config = await createConfig({ extends: ["minimal"] });
    const results: Array<{ identity: string; bytes: number; warnings: number }> = [];

    for (const identity of ["kaseki", "soyuz"] as const) {
      const document = buildOpenApiDocument(identity);
      const source = JSON.stringify(document);
      const problems = await lintFromString({ source, config });
      const errors = problems.filter((problem) => problem.severity === "error");
      expect(errors, `${identity} OpenAPI validation errors`).toEqual([]);
      expect(document).toMatchObject({
        openapi: "3.1.0",
        jsonSchemaDialect: "https://json-schema.org/draft/2020-12/schema",
      });
      results.push({
        identity,
        bytes: new TextEncoder().encode(source).byteLength,
        warnings: problems.filter((problem) => problem.severity === "warn").length,
      });
    }

    console.log(JSON.stringify({ validator: "@redocly/openapi-core 2.77.0", results }));
  });
});
