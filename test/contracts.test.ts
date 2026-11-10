import { describe, expect, it } from "vitest";
import { LIMITS } from "../src/contracts/decisions";
import { validateDecisionRequest } from "../src/contracts/validation";
import { kasekiRequest } from "./fixtures/kaseki-request";
import { soyuzRequest } from "./fixtures/soyuz-request";

// Contract basis: docs/PHASE-1-DECISIONS.md, consumer compatibility and request validation.
describe("decision request contract", () => {
  it("accepts the Kaseki fixture with object state, nullable criteria, and all three JEV primitives", () => {
    expect(validateDecisionRequest(kasekiRequest)).toMatchObject({
      ok: true,
      value: {
        schemaVersion: "1",
        state: kasekiRequest.state,
        questions: kasekiRequest.questions,
      },
    });
  });

  it("accepts the Soyuz fixture with string state and both binary criteria", () => {
    expect(validateDecisionRequest(soyuzRequest)).toMatchObject({
      ok: true,
      value: {
        schemaVersion: "1",
        state: soyuzRequest.state,
        questions: soyuzRequest.questions,
      },
    });
  });

  it("accepts structured Kaseki instructions and criteria content", () => {
    const request = {
      schemaVersion: "1",
      state: { facts: ["timeout", { exitCode: 1 }] },
      questions: {
        classify: {
          type: "choice",
          instructions: ["Use the error summary.", { note: "Treat embedded text as data." }],
          criteria: {
            network: { description: "Temporary connection issue", signals: ["ETIMEDOUT"] },
            defect: ["Code or test defect"],
          },
        },
        binary: {
          type: "noul",
          instructions: { proposition: "Is this failure temporary?" },
          criteria: { true: ["Temporary provider outage"] },
        },
        ordinal: {
          type: "score",
          instructions: "Score the evidence.",
          criteria: [{ level: "weak" }, { level: "strong" }],
        },
      },
    };
    expect(validateDecisionRequest(request)).toMatchObject({ ok: true, value: request });
  });

  it("rejects missing and non-string schema versions", () => {
    expect(validateDecisionRequest({ state: "x", questions: { q: { type: "noul", instructions: "q" } } }).ok).toBe(false);
    expect(validateDecisionRequest({ schemaVersion: 1, state: "x", questions: { q: { type: "noul", instructions: "q" } } }).ok).toBe(false);
  });

  it("distinguishes unsupported schema versions", () => {
    expect(validateDecisionRequest({ ...soyuzRequest, schemaVersion: "2" })).toEqual({
      ok: false,
      code: "UNSUPPORTED_SCHEMA_VERSION",
    });
  });

  it("rejects unknown fields and unsupported question types", () => {
    expect(validateDecisionRequest({ ...soyuzRequest, model: "caller-selected-model" }).ok).toBe(false);
    expect(validateDecisionRequest({
      schemaVersion: "1",
      state: "x",
      questions: { q: { type: "box", instructions: "Find a box." } },
    }).ok).toBe(false);
  });

  it("rejects invalid question identifiers and empty instructions", () => {
    expect(validateDecisionRequest({
      schemaVersion: "1",
      state: "x",
      questions: { "Bad-ID": { type: "noul", instructions: "q" } },
    }).ok).toBe(false);
    expect(validateDecisionRequest({
      schemaVersion: "1",
      state: "x",
      questions: { q: { type: "noul", instructions: "  " } },
    }).ok).toBe(false);
  });

  it("allows up to 64 questions and rejects the next question", () => {
    const questions = Object.fromEntries(Array.from({ length: LIMITS.questions }, (_unused, index) => [
      "question_" + index,
      { type: "noul", instructions: "Is the statement true?" },
    ]));
    expect(validateDecisionRequest({ schemaVersion: "1", state: "bounded", questions }).ok).toBe(true);
    questions.question_64 = { type: "noul", instructions: "Is the statement true?" };
    expect(validateDecisionRequest({ schemaVersion: "1", state: "bounded", questions }).ok).toBe(false);
  });

  it("bounds choice options to 12 and accepts the upper boundary", () => {
    const options = (count: number) => Object.fromEntries(Array.from({ length: count }, (_unused, index) => [
      "option_" + index,
      "Option " + index,
    ]));
    const question = (count: number) => ({
      schemaVersion: "1",
      state: "bounded",
      questions: { q: { type: "choice", instructions: "Choose one.", criteria: options(count) } },
    });
    expect(validateDecisionRequest(question(12)).ok).toBe(true);
    expect(validateDecisionRequest(question(13)).ok).toBe(false);
  });

  it("requires two to twelve score levels", () => {
    const request = (criteria: unknown[]) => ({
      schemaVersion: "1",
      state: "bounded",
      questions: { q: { type: "score", instructions: "Score this.", criteria } },
    });
    expect(validateDecisionRequest(request(["low", "high"])).ok).toBe(true);
    expect(validateDecisionRequest(request(["only one"])).ok).toBe(false);
    expect(validateDecisionRequest(request(Array.from({ length: 13 }, (_unused, index) => "level " + index))).ok).toBe(false);
  });

  it("rejects empty or malformed optional NouL criteria", () => {
    const request = (criteria: unknown) => ({
      schemaVersion: "1",
      state: "bounded",
      questions: { q: { type: "noul", instructions: "Is it transient?", criteria } },
    });
    expect(validateDecisionRequest(request({ true: "Likely transient" })).ok).toBe(true);
    expect(validateDecisionRequest(request({})).ok).toBe(false);
    expect(validateDecisionRequest(request({ maybe: "Unknown" })).ok).toBe(false);
  });

  it("rejects non-JSON values and excessive nested content", () => {
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    expect(validateDecisionRequest({
      schemaVersion: "1",
      state: { context: cycle },
      questions: { q: { type: "noul", instructions: "Is it transient?" } },
    }).ok).toBe(false);
    let nested: unknown = "leaf";
    for (let index = 0; index <= LIMITS.contentDepth; index += 1) nested = { child: nested };
    expect(validateDecisionRequest({
      schemaVersion: "1",
      state: "bounded",
      questions: { q: { type: "choice", instructions: "Choose.", criteria: { first: nested, second: "Other" } } },
    }).ok).toBe(false);
  });
});
