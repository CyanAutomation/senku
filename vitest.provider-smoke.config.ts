import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/provider-live-smoke.ts"],
    environment: "node",
    testTimeout: 35_000,
    hookTimeout: 35_000,
  },
});
