import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts"],
    exclude: ["**/node_modules/**", "apps/web/**", "**/dist/**"],
    // Each test file may open its own in-memory PGlite (a WASM Postgres); starting many at once on a busy machine is slow.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    env: { NODE_ENV: "test" },
  },
});
