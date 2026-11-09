import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/openapi-standards.test.ts"],
    globals: false,
  },
});
