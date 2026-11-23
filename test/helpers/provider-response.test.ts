import { describe, expect, it } from "vitest";
import type { DecisionRequest } from "../../src/contracts/decisions";
import { providerResponse } from "./provider-response";

describe("provider response test fixture", () => {
  it("returns an empty answer set when the request has no questions", async () => {
    const response = providerResponse({} as DecisionRequest);

    expect(await response.json()).toMatchObject({ answers: {} });
  });

  it("builds valid fixture answers for NouL, choice, and score questions", async () => {
    const request: DecisionRequest = {
      schemaVersion: "1",
      state: "bounded evidence",
      questions: {
        enough: { type: "noul", instructions: "Is there enough evidence?" },
        route: { type: "choice", instructions: "Which route?", criteria: { keep: "Keep", discard: "Discard" } },
        score: { type: "score", instructions: "How complete?", criteria: ["partial", "complete"] },
      },
    };
    const response = providerResponse(request, {
      noul: 0.6,
      choiceConfidence: 0.8,
      score: 1,
      scoreProbabilityIndex: 1,
      usage: { input_tokens: 12 },
    });

    expect(await response.json()).toMatchObject({
      answers: {
        enough: { type: "noul", noul: 0.6 },
        route: { type: "choice", choice: "keep", probabilities: { keep: 1, discard: 0 }, confidence: 0.8 },
        score: { type: "score", score: 1, legend: { "0": "partial", "1": "complete" }, probabilities: { "0": 0, "1": 1 } },
      },
      usage: { input_tokens: 12 },
    });
    expect(await providerResponse(request, { invalid: true }).json()).toMatchObject({ answers: {} });
  });
});
