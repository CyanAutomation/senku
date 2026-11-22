import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const skillsRoot = join(repoRoot, ".github", "skills");
const skillDirectories = readdirSync(skillsRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

function skillFile(name) {
  return join(skillsRoot, name, "SKILL.md");
}

function parseFrontmatter(markdown, file) {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  assert.ok(match, `${file} must start with YAML frontmatter`);

  const fields = Object.fromEntries(
    match[1].split(/\r?\n/).map((line) => {
      const field = line.match(/^([a-z][a-z0-9_-]*):\s*(.*)$/);
      assert.ok(field, `Unsupported frontmatter line in ${file}: ${line}`);
      return [field[1], field[2].trim()];
    }),
  );
  return fields;
}

function markdownFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory()
      ? markdownFiles(path)
      : entry.isFile() && entry.name.endsWith(".md")
        ? [path]
        : [];
  });
}

test("every skill has valid frontmatter and a matching name", () => {
  assert.ok(skillDirectories.length > 0, "at least one skill directory is required");

  for (const directory of skillDirectories) {
    const file = skillFile(directory);
    assert.ok(existsSync(file), `${directory} must contain SKILL.md`);
    const fields = parseFrontmatter(readFileSync(file, "utf8"), file);

    assert.equal(fields.name, directory, `${file} name must match its directory`);
    assert.match(fields.name, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.ok(fields.description.length > 0, `${file} needs a description`);
    assert.ok(fields.description.length <= 1024, `${file} description is too long`);
  }
});

test("the skills index covers every skill", () => {
  const indexFile = join(skillsRoot, "README.md");
  assert.ok(existsSync(indexFile), "create .github/skills/README.md");
  const index = readFileSync(indexFile, "utf8");

  for (const directory of skillDirectories) {
    assert.ok(index.includes(`\`${directory}\``), `index must list ${directory}`);
  }
});

test("CI runs the skill validator", () => {
  const packageJson = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
  const workflow = readFileSync(join(repoRoot, ".github", "workflows", "ci.yml"), "utf8");

  assert.equal(packageJson.scripts["validate:skills"], "node --test scripts/skills.test.mjs");
  assert.match(workflow, /^\s+- run: npm run validate:skills$/m);
});

test("local Markdown links in skill documentation resolve", () => {
  for (const file of markdownFiles(skillsRoot)) {
    const markdown = readFileSync(file, "utf8");
    for (const match of markdown.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      const href = match[1].trim();
      if (!href || /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("#")) continue;

      const path = decodeURIComponent(href.split(/[?#]/, 1)[0]);
      if (!path) continue;
      const target = resolve(dirname(file), path);
      const pathFromRoot = relative(repoRoot, target);
      assert.ok(
        !isAbsolute(pathFromRoot) && pathFromRoot !== ".." && !pathFromRoot.startsWith(`..${sep}`),
        `${file} links outside the repository: ${href}`,
      );
      assert.ok(existsSync(target), `${file} links to missing path ${href}`);
    }
  }
});

test("skills that advertise review work explain review and change modes", () => {
  for (const name of ["api-discovery-contracts", "security-workflow-review"]) {
    const markdown = readFileSync(skillFile(name), "utf8");
    assert.match(markdown, /^## Review mode$/m, `${name} needs a Review mode section`);
    assert.match(markdown, /^## Change mode$/m, `${name} needs a Change mode section`);
  }
});
