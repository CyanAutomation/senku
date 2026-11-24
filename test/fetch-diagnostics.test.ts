import { describe, expect, it } from "vitest";
import { classifyProviderFetchFailure } from "../src/providers/openrouter/fetch-diagnostics";

describe("provider fetch diagnostics", () => {
  it.each([
    ["ENOTFOUND", "dns"],
    ["EAI_AGAIN", "dns"],
    ["ECONNREFUSED", "connection"],
    ["ECONNRESET", "connection"],
    ["ETIMEDOUT", "timeout"],
    ["ERR_TLS_CERT_ALTNAME_INVALID", "tls"],
    ["CERT_HAS_EXPIRED", "tls"],
  ] as const)("maps known code %s to the bounded class %s", (code, expected) => {
    expect(classifyProviderFetchFailure(new Error("private low-level message", { cause: { code } }))).toBe(expected);
  });

  it("uses broad safe fallbacks for generic fetch errors and unknown exceptions", () => {
    expect(classifyProviderFetchFailure(new TypeError("private fetch details"))).toBe("network");
    expect(classifyProviderFetchFailure(new Error("private runtime details", { cause: { code: "SECRET_INTERNAL_CODE" } }))).toBe("unknown");
    expect(classifyProviderFetchFailure(new Error("reserved object key", { cause: { code: "constructor" } }))).toBe("unknown");
    expect(classifyProviderFetchFailure(new Error("timeout"), true)).toBe("timeout");
  });
});
