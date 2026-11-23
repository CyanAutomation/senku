import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const exceptions = new Map([
  ["GHSA-MRHX-C7XC-M3W5", { packageName: "zod", expiresOn: "2027-02-22" }],
]);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isHighSeverity(value) {
  return value === "high" || value === "critical";
}

export function parseAuditOutput(stdout, stderr = "") {
  let report;
  try {
    report = JSON.parse(stdout);
  } catch {
    throw new Error(`npm audit did not return JSON: ${stderr || stdout}`);
  }
  if (!isRecord(report)) throw new Error("npm audit returned an invalid report.");
  if (report.error) throw new Error(`npm audit failed: ${report.error.summary ?? report.error.message ?? report.error.code}`);
  return report;
}

function advisoriesFor(via) {
  return via.filter(isRecord);
}

function exceptionFor(packageName, vulnerability, id, today) {
  const exception = exceptions.get(id);
  if (exception
    && packageName === exception.packageName
    && vulnerability.fixAvailable === false
    && today <= exception.expiresOn) {
    return exception;
  }
  return undefined;
}

function findingForAdvisory(packageName, vulnerability, advisory, today) {
  const url = typeof advisory.url === "string" ? advisory.url : "";
  const id = /GHSA-[a-z0-9-]+/i.exec(url)?.[0]?.toUpperCase() ?? "unknown-advisory";
  const exception = exceptionFor(packageName, vulnerability, id, today);
  if (exception) return { exception: { id, packageName, expiresOn: exception.expiresOn } };

  return {
    finding: {
      id,
      packageName,
      severity: advisory.severity ?? vulnerability.severity,
      title: advisory.title ?? "High-severity dependency advisory",
      url,
    },
  };
}

function hasUntraceableParent(via, vulnerabilities) {
  if (via.length === 0) return true;
  return via.some((name) => {
    if (typeof name !== "string") return true;
    const parent = vulnerabilities[name];
    return !isRecord(parent) || !isHighSeverity(parent.severity);
  });
}

function evaluateVulnerability(packageName, vulnerability, vulnerabilities, today) {
  if (!isRecord(vulnerability) || !isHighSeverity(vulnerability.severity)) {
    return { findings: [], exceptions: [] };
  }

  const via = Array.isArray(vulnerability.via) ? vulnerability.via : [];
  const advisories = advisoriesFor(via);
  if (advisories.length === 0) {
    if (!hasUntraceableParent(via, vulnerabilities)) return { findings: [], exceptions: [] };
    return {
      findings: [{
        id: "unknown-advisory",
        packageName,
        severity: vulnerability.severity,
        title: "High-severity npm audit entry has no traceable advisory",
        url: "",
      }],
      exceptions: [],
    };
  }

  const findings = [];
  const acceptedExceptions = [];
  for (const advisory of advisories) {
    const result = findingForAdvisory(packageName, vulnerability, advisory, today);
    if (result.exception) acceptedExceptions.push(result.exception);
    else if (result.finding) findings.push(result.finding);
  }
  return { findings, exceptions: acceptedExceptions };
}

function runNpmAudit() {
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const audit = spawnSync(npm, ["audit", "--json"], {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  if (audit.error) throw audit.error;
  return parseAuditOutput(audit.stdout, audit.stderr);
}

function logAcceptedExceptions(acceptedExceptions) {
  for (const exception of acceptedExceptions) {
    console.warn(
      `Accepted unfixed ${exception.id} in ${exception.packageName} until ${exception.expiresOn}; review and remove this exception when an upstream fix is available.`,
    );
  }
}

function logFindings(findings) {
  if (findings.length === 0) return false;
  for (const finding of findings) {
    console.error(`${finding.severity} ${finding.id} in ${finding.packageName}: ${finding.title} ${finding.url}`);
  }
  process.exitCode = 1;
  return true;
}

export function evaluateAuditReport(report, today = new Date().toISOString().slice(0, 10)) {
  const vulnerabilities = isRecord(report) && isRecord(report.vulnerabilities) ? report.vulnerabilities : {};
  const result = { findings: [], exceptions: [] };

  for (const [packageName, vulnerability] of Object.entries(vulnerabilities)) {
    const assessed = evaluateVulnerability(packageName, vulnerability, vulnerabilities, today);
    result.findings.push(...assessed.findings);
    result.exceptions.push(...assessed.exceptions);
  }
  return result;
}

function run() {
  const result = evaluateAuditReport(runNpmAudit());
  logAcceptedExceptions(result.exceptions);
  if (logFindings(result.findings)) return;
  console.log(`Dependency audit passed with ${result.exceptions.length} temporary exception(s).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) run();
