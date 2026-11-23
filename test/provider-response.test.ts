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

const scoreRequest: DecisionRequest = {
  schemaVersion: "1",
  state: "bounded evidence",
  questions: {
    score: {
      type: "score",
      instructions: "How complete is the work?",
      criteria: ["not started", { state: "in progress" }, "complete"],
    },
  },
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

  it("validates score answers and derives a canonical legend when the provider omits it", () => {
    expect(validateProviderPayload({
      model: "typesafe/jev-1.14-20261014",
      answers: {
        score: {
          type: "score",
          score: 1,
          probabilities: { "0": 0.1, "1": 0.8, "2": 0.1 },
          confidence: 0.75,
        },
      },
      usage: { input_tokens: 12, output_tokens: 3, total_tokens: 15, cost: 0.0004, private: "ignored" },
    }, scoreRequest)).toEqual({
      model: "typesafe/jev-1.14-20261014",
      answers: {
        score: {
          type: "score",
          score: 1,
          legend: { "0": "not started", "1": "{\"state\":\"in progress\"}", "2": "complete" },
          probabilities: { "0": 0.1, "1": 0.8, "2": 0.1 },
          confidence: 0.75,
        },
      },
      usage: { input_tokens: 12, output_tokens: 3, total_tokens: 15, cost: 0.0004 },
    });
  });

  it("rejects invalid score distributions, legends, and confidence values", () => {
    const validAnswer = {
      type: "score",
      score: 1,
      legend: { "0": "not started", "1": "in progress", "2": "complete" },
      probabilities: { "0": 0.1, "1": 0.8, "2": 0.1 },
      confidence: 0.75,
    };
    const invalidAnswers = [
      { ...validAnswer, score: 3 },
      { ...validAnswer, score: -0.01 },
      { ...validAnswer, score: Number.NaN },
      { ...validAnswer, probabilities: { "0": 0.5, "1": 0.5 } },
      { ...validAnswer, legend: { "0": "wrong", "1": "in progress", "2": "complete" } },
      { ...validAnswer, legend: { "0": "not started", "1": "", "2": "complete" } },
      { ...validAnswer, legend: { "0": "not started", "1": "x".repeat(1_001), "2": "complete" } },
      { ...validAnswer, legend: { "0": 1, "1": "in progress", "2": "complete" } },
      { ...validAnswer, confidence: 1.01 },
    ];

    for (const answer of invalidAnswers) {
      expect(() => validateProviderPayload({
        model: "typesafe/jev-1.14-20261014",
        answers: { score: answer },
      }, scoreRequest)).toThrow(expect.objectContaining({ diagnosticCode: "response_answer_invalid" }));
    }
  });

  it("drops malformed usage fields and omits usage when nothing valid remains", () => {
    const normalized = validateProviderPayload({
      model: "typesafe/jev-1.14-20261014",
      answers: { q: { type: "noul", noul: 0.5 } },
      usage: {
        input_tokens: -1,
        output_tokens: 1.5,
        total_tokens: Number.MAX_SAFE_INTEGER + 1,
        cost: Number.POSITIVE_INFINITY,
      },
    }, request);
    expect(normalized).not.toHaveProperty("usage");
  });

  it("retains valid zero-valued usage fields while dropping malformed siblings", () => {
    const normalized = validateProviderPayload({
      model: "typesafe/jev-1.14-20261014",
      answers: { q: { type: "noul", noul: 0.5 } },
      usage: {
        input_tokens: 0,
        output_tokens: "unknown",
        total_tokens: 15,
        cost: 0,
        private: "ignored",
      },
    }, request);

    expect(normalized.usage).toEqual({ input_tokens: 0, total_tokens: 15, cost: 0 });
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
