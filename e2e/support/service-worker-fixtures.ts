// Fixtures for the Service Worker tests. Unlike fixtures.ts, the server lives for the whole
// Playwright worker, because the seeded profile's Service Workers are registered on its origins
// (service-worker-profile.ts). Its request logs therefore hold every test's requests in that
// worker: tell a test's own apart by its visits (server.beaconsFor), not by emptiness.
import { test as base } from "@playwright/test";
import { secureOriginArgs } from "./browser-flags.ts";
import { launchExtension, removeUserDataDir, type Extension } from "./extension.ts";
import { startServer, type TestServer } from "./server.ts";
import { copyProfile, seedServiceWorkerProfile } from "./service-worker-profile.ts";

interface WorkerFixtures {
  server: TestServer;
  /** The seeded profile. Tests use a copy (profileDir) and never this one. */
  seededProfileDir: string;
}

interface TestFixtures {
  /** A copy of the seeded profile, PunyGuard not yet installed, removed after the test. */
  profileDir: string;
  /** PunyGuard installed on profileDir, with the test server's origins treated as secure. */
  extension: Extension;
}

export const test = base.extend<TestFixtures, WorkerFixtures>({
  server: [
    // oxlint-disable-next-line no-empty-pattern -- Playwright reads the fixture's dependencies from this pattern
    async ({}, use) => {
      const server = await startServer();
      await use(server);
      await server.close();
    },
    { scope: "worker" },
  ],
  seededProfileDir: [
    async ({ server }, use) => {
      const seededDir = await seedServiceWorkerProfile(server);
      await use(seededDir);
      removeUserDataDir(seededDir);
    },
    { scope: "worker" },
  ],
  profileDir: async ({ seededProfileDir }, use) => {
    const profileDir = copyProfile(seededProfileDir);
    await use(profileDir);
    removeUserDataDir(profileDir);
  },
  extension: async ({ profileDir, server }, use) => {
    const extension = await launchExtension(profileDir, {}, secureOriginArgs(server.origins));
    try {
      await use(extension);
    } finally {
      await extension.context.close();
    }
  },
});

export { expect } from "@playwright/test";
