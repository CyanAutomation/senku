import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluateAuditReport, parseAuditOutput } from "./audit-dependencies.mjs";

const knownUnfixedZodAdvisory = {
  vulnerabilities: {
    zod: {
      severity: "high",
      fixAvailable: false,
      via: [{
        name: "zod",
        dependency: "zod",
        severity: "high",
        url: "https://github.com/advisories/GHSA-mrhx-c7xc-m3w5",
      }],
    },
    "@utcp/sdk": {
      severity: "high",
      fixAvailable: false,
      via: ["zod"],
    },
    "@utcp/http": {
      severity: "high",
      fixAvailable: false,
      via: ["@utcp/sdk"],
    },
  },
};

describe("dependency audit policy", () => {
  it("parses npm audit output and reports malformed or failed audit responses", () => {
    assert.deepEqual(parseAuditOutput('{"vulnerabilities":{}}'), { vulnerabilities: {} });
    assert.throws(() => parseAuditOutput("not json", "npm audit failed"), {
      message: "npm audit did not return JSON: npm audit failed",
    });
    assert.throws(() => parseAuditOutput('{"error":{"summary":"offline"}}'), {
      message: "npm audit failed: offline",
    });
  });

  it("temporarily permits the known unfixed Zod advisory and reports the exception", () => {
    const result = evaluateAuditReport(knownUnfixedZodAdvisory, "2026-11-22");

    assert.equal(result.findings.length, 0);
    assert.deepEqual(result.exceptions.map(({ id }) => id), ["GHSA-MRHX-C7XC-M3W5"]);
  });

  it("fails for an unknown high-severity advisory", () => {
    const report = {
      vulnerabilities: {
        example: {
          severity: "high",
          fixAvailable: false,
          via: [{
            name: "example",
            severity: "high",
            url: "https://github.com/advisories/GHSA-aaaa-bbbb-cccc",
          }],
        },
      },
    };

    assert.deepEqual(evaluateAuditReport(report, "2026-11-22").findings.map(({ id }) => id), ["GHSA-AAAA-BBBB-CCCC"]);
  });

  it("fails when a high-severity audit entry has no advisory details or vulnerable parent", () => {
    const report = {
      vulnerabilities: {
        example: {
          severity: "high",
          fixAvailable: false,
          via: ["unreported-dependency"],
        },
      },
    };

    assert.equal(evaluateAuditReport(report, "2026-11-22").findings.length, 1);
  });

  it("ignores malformed advisory entries without crashing and reports the untraceable finding", () => {
    const report = {
      vulnerabilities: {
        example: {
          severity: "high",
          fixAvailable: false,
          via: [null, "unreported-dependency"],
        },
      },
    };

    assert.deepEqual(evaluateAuditReport(report, "2026-11-22").findings, [{
      id: "unknown-advisory",
      packageName: "example",
      severity: "high",
      title: "High-severity npm audit entry has no traceable advisory",
      url: "",
    }]);
  });

  it("does not duplicate a high-severity advisory already reported for its vulnerable parent", () => {
    const report = {
      vulnerabilities: {
        parent: {
          severity: "high",
          via: [{ url: "https://github.com/advisories/GHSA-AAAA-BBBB-CCCC", severity: "high" }],
        },
        child: { severity: "high", via: ["parent"] },
      },
    };

    assert.deepEqual(evaluateAuditReport(report, "2026-11-22").findings.map(({ packageName }) => packageName), ["parent"]);
  });

  it("fails for the known advisory once a fix is available", () => {
    const report = structuredClone(knownUnfixedZodAdvisory);
    report.vulnerabilities.zod.fixAvailable = { name: "zod", version: "4.6.7" };

    assert.equal(evaluateAuditReport(report, "2026-11-22").findings.length, 1);
  });

  it("fails after the exception expiry date", () => {
    assert.equal(evaluateAuditReport(knownUnfixedZodAdvisory, "2027-02-23").findings.length, 1);
  });

  it("does not fail on moderate advisories", () => {
    const report = {
      vulnerabilities: {
        example: {
          severity: "moderate",
          fixAvailable: false,
          via: [{
            name: "example",
            severity: "moderate",
            url: "https://github.com/advisories/GHSA-aaaa-bbbb-cccc",
          }],
        },
      },
    };

    assert.equal(evaluateAuditReport(report, "2026-11-22").findings.length, 0);
  });
});
