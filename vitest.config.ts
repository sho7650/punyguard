import { defineConfig } from "vitest/config";

export default defineConfig({
  // Resolve packages the way esbuild does for the browser bundle (scripts/build.ts), so that
  // the tests import the same file that ships. Without this, Node picks "main" (CommonJS)
  // while the bundle gets "module" (ESM), and their exports can differ.
  ssr: {
    resolve: {
      mainFields: ["browser", "module", "main"],
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      // Thin entry points that touch browser APIs; covered by the E2E tests
      exclude: ["src/**/*.test.ts", "src/background.ts", "src/blocked.ts"],
      // Enforced from day one to keep tests first (D9)
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
});
