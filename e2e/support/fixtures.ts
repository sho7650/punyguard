// Each test gets its own server, profile and browser, so tests never share history,
// site access or the toolbar state.
import { test as base } from "@playwright/test";
import { launchExtension, newUserDataDir, type Extension } from "./extension.ts";
import { startServer, type TestServer } from "./server.ts";

interface Fixtures {
  /** LANGUAGE for Chromium. Linux Chromium picks its UI language from it; macOS ignores it. */
  uiLanguage: string;
  server: TestServer;
  extension: Extension;
}

export const test = base.extend<Fixtures>({
  uiLanguage: ["en", { option: true }],
  // oxlint-disable-next-line no-empty-pattern -- Playwright reads the fixture's dependencies from this pattern
  server: async ({}, use) => {
    const server = await startServer();
    await use(server);
    await server.close();
  },
  extension: async ({ uiLanguage }, use) => {
    const extension = await launchExtension(newUserDataDir(), { LANGUAGE: uiLanguage });
    await use(extension);
    await extension.context.close();
  },
});

export { expect } from "@playwright/test";
