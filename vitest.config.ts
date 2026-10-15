import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src"],
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
