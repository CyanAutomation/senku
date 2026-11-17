import { describe, expect, it } from "vitest";
import { LIMITS, type DecisionRequest } from "../src/contracts/decisions";
import { readBoundedResponse, validateProviderPayload } from "../src/providers/openrouter/response";

// Contract: docs/CONTRACT.md#profile-evaluation. These pin helper normalization and diagnostics;
// request construction and ProviderError mapping are covered in provider.test.ts.
const request: DecisionRequest = {
  schemaVersion: "1",
  state: "bounded evidence",
  questions: { q: { type: "noul", instructions: "Is the evidence sufficient?" } },
};

describe("OpenRouter response validation", () => {
  it("normalizes a provider payload into canonical answers and recognized usage fields", () => {
    expect(validateProviderPayload({
      model: "typesafe/jev-1.14-20261014",
      answers: { q: { type: "noul", noul: 0.75 } },
      usage: { input_tokens: 12, output_tokens: 3, private: "ignored" },
    }, request)).toEqual({
      model: "typesafe/jev-1.14-20261014",
      answers: { q: { type: "noul", noul: 0.75, probabilities: { false: 0.25, true: 0.75 }, confidence: null } },
      usage: { input_tokens: 12, output_tokens: 3 },
    });
  });

  it("assigns stable diagnostics to answer sets and values that do not match the request", () => {
    expect(() => validateProviderPayload({ model: "model", answers: { other: { type: "noul", noul: 0.5 } } }, request))
      .toThrow(expect.objectContaining({ diagnosticCode: "response_answer_set_mismatch" }));
    expect(() => validateProviderPayload({
      model: "model",
      answers: {
        q: { type: "noul", noul: 0.5 },
        other: { type: "noul", noul: 0.5 },
      },
    }, request)).toThrow(expect.objectContaining({ diagnosticCode: "response_answer_set_mismatch" }));
    expect(() => validateProviderPayload({ model: "model", answers: { q: { type: "noul", noul: 0.5, extra: true } } }, request))
      .toThrow(expect.objectContaining({ diagnosticCode: "response_answer_invalid" }));
  });

  it("assigns stable diagnostics to missing, malformed, and oversized response bodies", async () => {
    await expect(readBoundedResponse(new Response(null))).rejects.toMatchObject({ diagnosticCode: "response_body_missing" });
    await expect(readBoundedResponse(new Response("{"))).rejects.toMatchObject({ diagnosticCode: "response_body_invalid_json" });
    const oversized = new Response("x".repeat(LIMITS.providerResponseBytes + 1));
    await expect(readBoundedResponse(oversized)).rejects.toMatchObject({ diagnosticCode: "response_body_too_large" });
  });
});
