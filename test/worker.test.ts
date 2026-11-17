import { describe, expect, it, vi } from "vitest";
import { createWorker } from "../src/index";
import { makeTestEnvironment } from "./helpers/environment";

const env = makeTestEnvironment("worker");

describe("Worker routes", () => {
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
