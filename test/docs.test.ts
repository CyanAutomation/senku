import { describe, expect, it } from "vitest";
import { buildOpenApiDocument } from "../src/api/openapi";
import { createWorker } from "../src/index";
import { makeTestEnvironment } from "./helpers/environment";

const env = makeTestEnvironment("docs");

describe("HTML API documentation", () => {
  it("serves a self-contained shell that loads the caller-filtered OpenAPI document", async () => {
    const worker = createWorker({ logger: () => undefined });
    const response = await worker.fetch(new Request("https://senku.test/docs/"), {});
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/^text\/html; charset=utf-8$/);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    const contentSecurityPolicy = response.headers.get("content-security-policy") ?? "";
    expect(contentSecurityPolicy).toMatch(/default-src 'none'/);
    const nonce = /<script nonce="([^"]+)">/.exec(html)?.[1];
    expect(nonce).toBeDefined();
    expect(contentSecurityPolicy).toContain(`script-src 'nonce-${nonce}'`);
    expect(contentSecurityPolicy).toContain(`style-src 'nonce-${nonce}'`);
    expect(html).toContain('id="bearer-token"');
    expect(html).toContain('type="password"');
    expect(html).toContain('/openapi.json');
    expect(html).toContain("textContent");
    expect(html).toContain('credentials: "omit"');
    expect(html).not.toContain("localStorage");
    expect(html).not.toContain("innerHTML");
    expect(html).not.toContain("task_admission_v1");
    expect(html).not.toMatch(/<script[^>]+src=/i);
    expect(html).not.toMatch(/https?:\/\/(?!senku\.test)/i);
  });

  it("keeps the OpenAPI document protected and supports only GET on the docs routes", async () => {
    const worker = createWorker({ logger: () => undefined });
    const openapi = await worker.fetch(new Request("https://senku.test/openapi.json"), env);
    const wrongMethod = await worker.fetch(new Request("https://senku.test/docs/", { method: "POST" }), env);
    const alias = await worker.fetch(new Request("https://senku.test/docs"), env);

    expect(openapi.status).toBe(401);
    expect(wrongMethod.status).toBe(405);
    expect(wrongMethod.headers.get("allow")).toBe("GET");
    expect(alias.status).toBe(308);
    expect(alias.headers.get("location")).toBe("/docs/");
  });

  it("describes both documentation routes as public in each permission-filtered OpenAPI document", () => {
    for (const identity of ["kaseki", "soyuz"] as const) {
      const document = buildOpenApiDocument(identity) as {
        paths: Record<string, { get: { security: unknown[]; responses: Record<string, unknown> } }>;
      };

      expect(document.paths["/docs/"].get.security).toEqual([]);
      expect(document.paths["/docs/"].get.responses).toHaveProperty("200");
      expect(document.paths["/docs"].get.security).toEqual([]);
      expect(document.paths["/docs"].get.responses).toHaveProperty("308");
    }
  });
});
