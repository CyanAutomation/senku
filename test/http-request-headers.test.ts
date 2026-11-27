import { describe, expect, it } from "vitest";
import { correlationIdFromHeader, isValidCorrelationId } from "../src/http/correlation-id";
import { parseSenkuDeadlineMs, remainingProviderBudgetMs } from "../src/http/deadline";

describe("request correlation primitive", () => {
  it("accepts bounded printable correlation IDs and falls back when absent", () => {
    expect(isValidCorrelationId("kaseki-7f8e9d" )).toBe(true);
    expect(correlationIdFromHeader(null, "dec-fallback")).toBe("dec-fallback");
    expect(correlationIdFromHeader("soyuz/request:17", "dec-fallback")).toBe("soyuz/request:17");
    expect(correlationIdFromHeader("bad\nvalue", "dec-fallback")).toBeNull();
    expect(isValidCorrelationId("x".repeat(129))).toBe(false);
  });
});

describe("deadline budget primitive", () => {
  it("parses an absolute millisecond deadline and clamps it to the configured budget", () => {
    expect(parseSenkuDeadlineMs(null)).toBeUndefined();
    expect(parseSenkuDeadlineMs("1700000010000")).toBe(1_700_000_010_000);
    expect(parseSenkuDeadlineMs("0")).toBeNull();
    expect(parseSenkuDeadlineMs("1e12")).toBeNull();
    expect(remainingProviderBudgetMs(1_700_000_010_000, 15_000, 1_700_000_000_000)).toBe(10_000);
    expect(remainingProviderBudgetMs(1_700_000_100_000, 15_000, 1_700_000_000_000)).toBe(15_000);
    expect(remainingProviderBudgetMs(1_700_000_000_500, 15_000, 1_700_000_000_000)).toBe(500);
  });
});
