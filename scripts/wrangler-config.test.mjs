import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const config = JSON.parse(await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8"));

test("production Wrangler config keeps Worker Preview URLs disabled", () => {
  assert.equal(config.preview_urls, false);
});

test("production Wrangler config preserves Worker invocation logs", () => {
  assert.equal(config.observability?.logs?.invocation_logs, true);
  assert.equal(config.observability?.logs?.head_sampling_rate, 1);
});

test("production Wrangler config binds per-IP and per-client admission limits", () => {
  assert.deepEqual(new Set((config.ratelimits ?? []).map(({ name }) => name)), new Set([
    "SENKU_RATE_LIMIT_IP",
    "SENKU_RATE_LIMIT_KASEKI",
    "SENKU_RATE_LIMIT_SOYUZ",
    "SENKU_RATE_LIMIT_RUSTY_FOSSIL",
  ]));
  assert.ok((config.ratelimits ?? []).every(({ simple }) => [10, 60].includes(simple.period)));
});
