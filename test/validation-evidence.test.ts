import { expect, it } from "vitest";
import { redactKasekiEvidence } from "../src/profiles/validation-evidence";

// Contract: docs/PROFILES.md#validation_recovery_v1; the provider projection must not retain private-key material.
it("redacts complete PEM keys and the remainder after an unmatched header", () => {
  const completeKey = "-----BEGIN RSA PRIVATE KEY-----\nprivate material\n-----END RSA PRIVATE KEY-----";
  const incompleteKey = "-----BEGIN RSA PRIVATE KEY-----\nprivate material without a footer";

  expect(redactKasekiEvidence(completeKey)).toBe("[REDACTED_PRIVATE_KEY]");
  expect(redactKasekiEvidence(incompleteKey)).toBe("[REDACTED_PRIVATE_KEY]");
  expect(redactKasekiEvidence(`safe prefix\n${incompleteKey}`)).toBe("safe prefix\n[REDACTED_PRIVATE_KEY]");
});

it("redacts from the first unmatched PEM header through later key blocks", () => {
  const incompleteKeys = [
    "-----BEGIN RSA PRIVATE KEY----- no footer",
    "-----BEGIN EC PRIVATE KEY----- no footer",
  ];
  const completeKey = "-----BEGIN RSA PRIVATE KEY-----\nprivate material\n-----END RSA PRIVATE KEY-----";

  expect(redactKasekiEvidence(`${incompleteKeys.join("\n")}\n${completeKey}`))
    .toBe("[REDACTED_PRIVATE_KEY]");
});
