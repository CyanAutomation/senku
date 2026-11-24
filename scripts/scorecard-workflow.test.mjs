import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const workflow = readFileSync(
  join(repoRoot, ".github", "workflows", "scorecard.yml"),
  "utf8",
);

function getStepBlock(stepName) {
  const lines = workflow.split("\n");
  const start = lines.findIndex((line) => line.trim() === `- name: ${stepName}`);
  assert.notEqual(start, -1, `workflow is missing step ${stepName}`);

  const nextStep = lines.findIndex(
    (line, index) => index > start && /^      - name: /.test(line),
  );
  return lines.slice(start, nextStep === -1 ? undefined : nextStep).join("\n");
}

test("SARIF uploads run after failures only when analysis produced a file", async (t) => {
  for (const stepName of ["Upload SARIF artifact", "Upload to code scanning"]) {
    await t.test(stepName, () => {
      const step = getStepBlock(stepName);
      assert.match(
        step,
        /^\s+if: always\(\) && hashFiles\('results\.sarif'\) != ''\s*$/m,
      );
    });
  }
});
