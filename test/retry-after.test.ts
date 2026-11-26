import { describe, expect, it } from "vitest";
import { isValidRetryAfterSeconds, MAX_RETRY_AFTER_SECONDS, parseRetryAfterSeconds } from "../src/http/retry-after";

describe("Retry-After helpers", () => {
  it("parses bounded delta-seconds", () => {
    expect(parseRetryAfterSeconds("0")).toBe(0);
    expect(parseRetryAfterSeconds("7")).toBe(7);
    expect(parseRetryAfterSeconds(String(MAX_RETRY_AFTER_SECONDS))).toBe(MAX_RETRY_AFTER_SECONDS);
    expect(parseRetryAfterSeconds(String(MAX_RETRY_AFTER_SECONDS + 1))).toBeUndefined();
  });

  it("normalizes standard HTTP dates to a non-negative delay", () => {
    const now = Date.UTC(2026, 10, 26, 18, 0, 0);
    expect(parseRetryAfterSeconds("Thu, 26 Nov 2026 18:00:05 GMT", now)).toBe(5);
    expect(parseRetryAfterSeconds("Thu, 26 Nov 2026 17:59:55 GMT", now)).toBe(0);
  });

  it("rejects malformed and unsafe hints", () => {
    for (const value of [null, "", "-7", "+7", "1.5", "NaN", "86401", "9".repeat(129)]) {
      expect(parseRetryAfterSeconds(value)).toBeUndefined();
    }
    expect(isValidRetryAfterSeconds(0)).toBe(true);
    expect(isValidRetryAfterSeconds(MAX_RETRY_AFTER_SECONDS)).toBe(true);
    expect(isValidRetryAfterSeconds(-1)).toBe(false);
    expect(isValidRetryAfterSeconds(MAX_RETRY_AFTER_SECONDS + 1)).toBe(false);
    expect(isValidRetryAfterSeconds("7")).toBe(false);
  });
});
