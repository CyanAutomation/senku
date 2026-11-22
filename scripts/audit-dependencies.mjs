import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const exceptions = new Map([
  ["GHSA-MRHX-C7XC-M3W5", { packageName: "zod", expiresOn: "2027-02-22" }],
]);

export function evaluateAuditReport(report, today = new Date().toISOString().slice(0, 10)) {
  const findings = [];
  const acceptedExceptions = [];

  for (const [packageName, vulnerability] of Object.entries(report.vulnerabilities ?? {})) {
    if (!["high", "critical"].includes(vulnerability.severity)) continue;

    const via = vulnerability.via ?? [];
    const advisories = via.filter((item) => typeof item === "object");
    for (const advisory of advisories) {
      const id = /GHSA-[a-z0-9-]+/i.exec(advisory.url ?? "")?.[0]?.toUpperCase() ?? "unknown-advisory";
      const exception = exceptions.get(id);
      const canUseException = exception
        && packageName === exception.packageName
        && vulnerability.fixAvailable === false
        && today <= exception.expiresOn;

      if (canUseException) {
        acceptedExceptions.push({ id, packageName, expiresOn: exception.expiresOn });
      } else {
        findings.push({
          id,
          packageName,
          severity: advisory.severity ?? vulnerability.severity,
          title: advisory.title ?? "High-severity dependency advisory",
          url: advisory.url ?? "",
        });
      }
    }

    if (advisories.length === 0) {
      const unresolvedParents = via.filter((name) => {
        const parent = report.vulnerabilities?.[name];
        return !parent || !["high", "critical"].includes(parent.severity);
      });
      if (via.length === 0 || unresolvedParents.length > 0) {
        findings.push({
          id: "unknown-advisory",
          packageName,
          severity: vulnerability.severity,
          title: "High-severity npm audit entry has no traceable advisory",
          url: "",
        });
      }
    }
  }

  return { findings, exceptions: acceptedExceptions };
}

function run() {
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const audit = spawnSync(npm, ["audit", "--json"], {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });

  if (audit.error) throw audit.error;

  let report;
  try {
    report = JSON.parse(audit.stdout);
  } catch {
    throw new Error(`npm audit did not return JSON: ${audit.stderr || audit.stdout}`);
  }
  if (report.error) throw new Error(`npm audit failed: ${report.error.summary ?? report.error.message ?? report.error.code}`);

  const result = evaluateAuditReport(report);
  for (const exception of result.exceptions) {
    console.warn(
      `Accepted unfixed ${exception.id} in ${exception.packageName} until ${exception.expiresOn}; review and remove this exception when an upstream fix is available.`,
    );
  }

  if (result.findings.length > 0) {
    for (const finding of result.findings) {
      console.error(`${finding.severity} ${finding.id} in ${finding.packageName}: ${finding.title} ${finding.url}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(`Dependency audit passed with ${result.exceptions.length} temporary exception(s).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) run();
