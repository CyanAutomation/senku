import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  define: {
    __SENKU_PERF_SMOKE__: "true",
  },
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
    }),
  ],
  test: {
    include: ["test/performance.smoke.test.ts", "test/utcp.test.ts"],
    testNamePattern: /^(?:benchmarks|discovers and invokes a (?:Kaseki|Soyuz) tool)/,
    globals: false,
  },
});
