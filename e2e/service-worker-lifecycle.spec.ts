// Blocking the pages a Service Worker answers keeps working after the extension is installed
// again, reloaded or updated (requirements FR-6, V-4), and the permissions it needs add no
// install warning (C-1, V-5).
//
// A true browser restart, with the extension installed and not installed again, keeps the
// extension's dynamic content script, and the first navigation was blocked (2026-10-20, 10 of 10,
// with the extension installed as an external extension). That cannot be reproduced here:
// launchExtension's --load-extension installs the extension again on every launch
// (protection.spec.ts), so a relaunch here is a reinstall. A reinstall, an update and a reload
// do drop the registration: a probe script that a test registered next to the extension's was
// gone after 5 of 5 reloads, 5 of 5 updates and 5 of 5 relaunches (2026-10-20, Chromium 156).
// Only the extension's own came back, registered again by onInstalled (src/background.ts)
// 70-83 ms after the reloaded worker started (5 runs). A navigation in that window shows the
// attacker page (10 of 10 right after a reload and 10 of 10 as the first page of a relaunch), a
// limit that the requirements and ADR-0004 document. So each test waits for the registration
// before its first navigation, and none checks the window itself.
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { contentScriptRegistration } from "../src/core/content-script.ts";
import { DEFAULT_SETTINGS } from "../src/core/settings.ts";
import { secureOriginArgs } from "./support/browser-flags.ts";
import {
  DIST,
  launchExtension,
  registeredContentScriptFiles,
  removeUserDataDir,
  type Extension,
} from "./support/extension.ts";
import { expect, test } from "./support/service-worker-fixtures.ts";
import { expectWarningPage, openVisit } from "./support/service-worker-outcome.ts";
import type { TestServer } from "./support/server.ts";

// The permissions before PunyGuard blocked Service Worker pages: main's manifest.json, which
// differed from this branch's only in these (git show main:manifest.json, 2026-10-20).
const PERMISSIONS_BEFORE: readonly string[] = ["declarativeNetRequest", "storage"];

async function expectContentScriptRegistered(extension: Extension): Promise<void> {
  await expect
    .poll(() => registeredContentScriptFiles(extension.worker))
    .toEqual(contentScriptRegistration(DEFAULT_SETTINGS).js);
}

// The first navigation in the browser: a Service Worker's page with user info, the attack that
// works even after PunyGuard is installed.
async function expectFirstVisitBlocked(extension: Extension, server: TestServer): Promise<void> {
  const page = await extension.context.newPage();
  const visit = server.attackerVisit("userinfo", "synthetic");
  await openVisit(page, visit);
  await expectWarningPage(page, extension, server, visit, "userinfo");
}

// chrome.runtime.reload() leaves an extension loaded from the command line disabled
// (DISABLE_UNSUPPORTED_DEVELOPER_EXTENSION in chrome://extensions-internals, 3 of 3 runs,
// 2026-10-20) unless developer mode is on, as it is for anyone who loads it unpacked.
async function enableDeveloperMode(extension: Extension): Promise<void> {
  const page = await extension.context.newPage();
  await page.goto("chrome://extensions");
  const toggle = page.locator("#devMode");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await page.close();
}

// Reloads the extension from its directory, as chrome://extensions does, and returns it with
// the new worker. The reload comes after evaluate has returned, since it ends the worker.
async function reloadExtension(extension: Extension): Promise<Extension> {
  const nextWorker = extension.context.waitForEvent("serviceworker");
  await extension.worker.evaluate(() => {
    setTimeout(() => {
      chrome.runtime.reload();
    }, 0);
  });
  return { ...extension, worker: await nextWorker };
}

function manifestVersion(extension: Extension): Promise<string> {
  return extension.worker.evaluate(() => chrome.runtime.getManifest().version);
}

// A fourth part makes any version higher.
function raiseVersion(extensionDir: string): string {
  const manifestPath = path.join(extensionDir, "manifest.json");
  // dist/manifest.json is the build's copy of manifest.json.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- always a manifest (above)
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as chrome.runtime.Manifest;
  const raised = `${manifest.version}.1`;
  writeFileSync(manifestPath, JSON.stringify({ ...manifest, version: raised }));
  return raised;
}

// A relaunch installs the extension again here (above), so this checks the reinstall: once
// onInstalled has registered the content script again, the first navigation is blocked.
test("after a relaunch, which reinstalls the extension, the first visit to a Service Worker's page is blocked", async ({
  extension,
  profileDir,
  server,
}) => {
  await extension.context.close();

  const relaunched = await launchExtension(profileDir, {}, secureOriginArgs(server.origins));
  try {
    await expectContentScriptRegistered(relaunched);
    await expectFirstVisitBlocked(relaunched, server);
  } finally {
    await relaunched.context.close();
  }
});

test.describe("after the extension is reloaded, a Service Worker's page is blocked", () => {
  for (const change of ["reload", "update"] as const) {
    test(change, async ({ profileDir, server }) => {
      // A copy, so the update can raise the version without touching dist/
      const extensionDir = mkdtempSync(path.join(tmpdir(), "punyguard-dist-"));
      cpSync(DIST, extensionDir, { recursive: true });
      try {
        const extension = await launchExtension(
          profileDir,
          {},
          secureOriginArgs(server.origins),
          extensionDir,
        );
        try {
          await enableDeveloperMode(extension);
          const version = await manifestVersion(extension);
          const expectedVersion = change === "update" ? raiseVersion(extensionDir) : version;

          const reloaded = await reloadExtension(extension);

          expect(await manifestVersion(reloaded)).toBe(expectedVersion);
          await expectContentScriptRegistered(reloaded);
          await expectFirstVisitBlocked(reloaded, server);
        } finally {
          await extension.context.close();
        }
      } finally {
        removeUserDataDir(extensionDir);
      }
    });
  }
});

// getPermissionWarningsByManifest needs no management permission (the chrome.management docs;
// it answered from this extension's worker, 2026-10-20).
test("blocking Service Worker pages adds no permission warning", async ({ extension }) => {
  const manifest = await extension.worker.evaluate(() => chrome.runtime.getManifest());
  const warnings = (permissions: readonly string[]): Promise<string[]> =>
    extension.worker.evaluate(
      (json) => chrome.management.getPermissionWarningsByManifest(json),
      JSON.stringify({ ...manifest, permissions }),
    );
  const current = manifest.permissions ?? [];

  expect(await warnings(current)).toEqual(await warnings(PERMISSIONS_BEFORE));
  // The comparison can tell: a permission with a warning of its own adds a line.
  expect(await warnings([...current, "bookmarks"])).toHaveLength(
    (await warnings(current)).length + 1,
  );
});
