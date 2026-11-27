import { describe, expect, it, vi } from "vitest";
import { checkRateLimit } from "../src/admission/rate-limit";

describe("rate limit binding primitive", () => {
  it("returns a stable result for allowed, blocked, and unavailable bindings", async () => {
    const allowed = { limit: vi.fn(async () => ({ success: true })) };
    const blocked = { limit: vi.fn(async () => ({ success: false })) };
    const unavailable = { limit: vi.fn(async () => { throw new Error("platform detail"); }) };
    expect(await checkRateLimit(allowed, "client:kaseki")).toBe("allowed");
    expect(await checkRateLimit(blocked, "client:kaseki")).toBe("limited");
    expect(await checkRateLimit(unavailable, "client:kaseki")).toBe("unavailable");
    expect(allowed.limit).toHaveBeenCalledWith({ key: "client:kaseki" });
  });
});
