import { describe, expect, it } from "vitest";
import type { DecisionRequest } from "../../src/contracts/decisions";
import { providerResponse } from "./provider-response";

describe("provider response test fixture", () => {
  it("returns an empty answer set when the request has no questions", async () => {
    const response = providerResponse({} as DecisionRequest);

    expect(await response.json()).toMatchObject({ answers: {} });
  });
});
