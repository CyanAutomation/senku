import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const config = JSON.parse(await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8"));

test("production Wrangler config keeps Worker Preview URLs disabled", () => {
  assert.equal(config.preview_urls, false);
});
