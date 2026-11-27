import { describe, expect, it } from "vitest";
import { createProfileContractArtifact } from "../src/contracts/profile-artifact";
import artifact from "../contracts/senku-profiles.v1.json";

describe("pinned public profile contract artifact", () => {
  it("matches the current profile registry without exporting question prompts", () => {
    expect(artifact).toEqual(createProfileContractArtifact());
    const hasPromptField = (value: unknown): boolean => {
      if (Array.isArray(value)) return value.some(hasPromptField);
      if (!value || typeof value !== "object") return false;
      return Object.entries(value).some(([key, child]) =>
        key === "instructions" || key === "criteria" || hasPromptField(child),
      );
    };
    expect(hasPromptField(artifact)).toBe(false);
  });
});
