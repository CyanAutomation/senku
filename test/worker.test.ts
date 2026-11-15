import { describe, expect, it, vi } from "vitest";
import { createWorker } from "../src/index";
import { makeTestEnvironment } from "./helpers/environment";

const env = makeTestEnvironment("worker");

describe("Worker routes", () => {
  it("does not expose caller-defined decisions over HTTP", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const response = await createWorker({ fetchImpl, logger: () => undefined }).fetch(
      new Request("https://senku.test/v1/decisions", {
        method: "POST",
        headers: {
          authorization: `Bearer ${env.SENKU_KASEKI_API_TOKEN}`,
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

  it("advertises GET for unsupported health and readiness methods", async () => {
    const worker = createWorker({ logger: () => undefined });
    for (const path of ["/healthz", "/readyz"]) {
      const response = await worker.fetch(new Request(`https://senku.test${path}`, { method: "POST" }), env);
      expect(response.status).toBe(405);
      expect(response.headers.get("allow")).toBe("GET");
    }
  });
});
