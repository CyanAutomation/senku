import { expect, it } from "vitest";
import { redactKasekiEvidence } from "../src/profiles/validation-evidence";

it("redacts complete PEM keys and leaves an unmatched header intact", () => {
  const completeKey = "-----BEGIN RSA PRIVATE KEY-----\nprivate material\n-----END RSA PRIVATE KEY-----";
  const incompleteKey = "-----BEGIN RSA PRIVATE KEY-----\nprivate material without a footer";

  expect(redactKasekiEvidence(completeKey)).toBe("[REDACTED_PRIVATE_KEY]");
  expect(redactKasekiEvidence(incompleteKey)).toBe(incompleteKey);
});

it("does not let an unmatched PEM header consume a later complete key", () => {
  const incompleteKeys = [
    "-----BEGIN RSA PRIVATE KEY----- no footer",
    "-----BEGIN EC PRIVATE KEY----- no footer",
  ];
  const completeKey = "-----BEGIN RSA PRIVATE KEY-----\nprivate material\n-----END RSA PRIVATE KEY-----";

  expect(redactKasekiEvidence(`${incompleteKeys.join("\n")}\n${completeKey}`))
    .toBe(`${incompleteKeys.join("\n")}\n[REDACTED_PRIVATE_KEY]`);
});
