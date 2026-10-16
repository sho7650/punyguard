import { defineConfig } from "@playwright/test";

// The tests load dist/, so run them through `pnpm run test:e2e`, which builds first.
export default defineConfig({
  testDir: "e2e",
  testMatch: "**/*.spec.ts",
  // Every test starts its own browser and server, so they can all run side by side.
  fullyParallel: true,
  forbidOnly: process.env["CI"] !== undefined,
  reporter: process.env["CI"] === undefined ? "list" : [["list"], ["html", { open: "never" }]],
});
