import { describe, expect, it, vi } from "vitest";
import { createWorker } from "../src/index";
import type { Environment } from "../src/contracts/decisions";

const env: Environment = {
  OPENROUTER_API_KEY: "test-openrouter-key",
  SENKU_KASEKI_API_TOKEN: "test-client-token-0123456789abcdef",
  SENKU_SOYUZ_API_TOKEN: "test-soyuz-token-0123456789abcdef",
  SENKU_PUBLIC_BASE_URL: "https://senku.scheimann.workers.dev",
  JEV_MODEL: "~typesafe/jev-latest",
  SENKU_PROVIDER_TIMEOUT_MS: "15000",
};

describe("Worker routes", () => {
  it("does not expose caller-defined decisions over HTTP", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const response = await createWorker({ fetchImpl, logger: () => undefined }).fetch(
      new Request("https://senku.test/v1/decisions", {
        method: "POST",
        headers: {
          authorization: "Bearer test-client-token-0123456789abcdef",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          schemaVersion: "1",
          state: { status: "failed", evidence: "bounded" },
          questions: { q: { type: "noul", instructions: "Is this safe?" } },
        }),
      }),
      env,
    );

    expect(response.status).toBe(404);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("keeps liveness and readiness checks independent of provider calls", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const worker = createWorker({ fetchImpl, logger: () => undefined });
    const health = await worker.fetch(new Request("https://senku.test/healthz"), {});
    const ready = await worker.fetch(new Request("https://senku.test/readyz"), env);
    const notReady = await worker.fetch(new Request("https://senku.test/readyz"), {
      ...env,
      SENKU_PROVIDER_TIMEOUT_MS: "30001",
    });

    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ status: "ok" });
    expect(ready.status).toBe(200);
    expect(await ready.json()).toEqual({ status: "ready" });
    expect(notReady.status).toBe(503);
    expect(await notReady.json()).toEqual({ status: "not_ready" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
