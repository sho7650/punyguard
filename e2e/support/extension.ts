/// <reference types="chrome" />
// Starts Chromium with the built extension (dist/) loaded and waits until the block rules are in.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium, expect, type BrowserContext, type Worker } from "@playwright/test";
import { contentScriptRegistration } from "../../src/service-worker-navigation/settings-script.ts";
import { DEFAULT_SETTINGS, loadSettings, type Settings } from "../../src/settings/settings.ts";
import { BROWSER_ARGS } from "./browser-flags.ts";

// The rules registered with the default settings: IDN hosts, userinfo and IP address hosts.
export const DEFAULT_RULE_IDS: readonly number[] = [1, 2, 3, 7];

export const DIST = path.resolve(import.meta.dirname, "../../dist");

export interface Extension {
  readonly context: BrowserContext;
  readonly worker: Worker;
  readonly id: string;
  readonly warningPageUrl: string;
}

export function newUserDataDir(): string {
  return mkdtempSync(path.join(tmpdir(), "punyguard-e2e-"));
}

export function removeUserDataDir(userDataDir: string): void {
  rmSync(userDataDir, { recursive: true, force: true });
}

// extraArgs adds switches, such as secureOriginArgs for the Service Worker tests, which launch
// PunyGuard on a profile seeded without it (service-worker-profile.ts). extensionDir loads a
// copy of dist/ instead, which a test may change, as the update test does.
export async function launchExtension(
  userDataDir: string,
  env: Readonly<Record<string, string>> = {},
  extraArgs: readonly string[] = [],
  extensionDir: string = DIST,
): Promise<Extension> {
  const context = await chromium.launchPersistentContext(userDataDir, {
    // Only the new headless mode (or a headed browser) loads extensions; the default
    // headless shell does not.
    channel: "chromium",
    args: [
      `--disable-extensions-except=${extensionDir}`,
      `--load-extension=${extensionDir}`,
      ...BROWSER_ARGS,
      ...extraArgs,
    ],
    env: { ...process.env, ...env },
  });
  try {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
    // onInstalled registers the rules, then the content script, asynchronously after the worker
    // starts. Waiting for both keeps a test from navigating, or stopping the worker, in between.
    await expect.poll(() => dynamicRuleIds(worker)).toEqual(new Set(DEFAULT_RULE_IDS));
    await expect
      .poll(() => registeredContentScriptFiles(worker))
      .toEqual(contentScriptRegistration(DEFAULT_SETTINGS).js);
    const id = new URL(worker.url()).host;
    return { context, worker, id, warningPageUrl: `chrome-extension://${id}/blocked.html` };
  } catch (error) {
    await context.close();
    throw error;
  }
}

export function dynamicRules(worker: Worker): Promise<chrome.declarativeNetRequest.Rule[]> {
  return worker.evaluate(() => chrome.declarativeNetRequest.getDynamicRules());
}

// A set, so that comparing it ignores the order Chrome returns the rules in.
export async function dynamicRuleIds(worker: Worker): Promise<ReadonlySet<number>> {
  return new Set((await dynamicRules(worker)).map((rule) => rule.id));
}

// Writes the settings as the options page does and waits until the service worker has
// registered the rules and the content script they call for.
export async function saveSettings(
  extension: Extension,
  saved: Settings,
  expectedRuleIds: readonly number[],
): Promise<void> {
  await saveRawSettings(extension, saved, expectedRuleIds);
}

// The same, with any value saved, to stand in for broken settings.
export async function saveRawSettings(
  extension: Extension,
  saved: unknown,
  expectedRuleIds: readonly number[],
): Promise<void> {
  await extension.worker.evaluate((settings) => chrome.storage.local.set({ settings }), saved);
  await expect.poll(() => dynamicRuleIds(extension.worker)).toEqual(new Set(expectedRuleIds));
  // The content script is updated after the rules. Until then it still blocks by the earlier
  // settings, so a navigation right away could be sent to the warning page. Settings that
  // cannot be used fall back to the defaults, as in the extension.
  const settings = await loadSettings(
    () => Promise.resolve(saved),
    () => {
      // Broken settings are what saveRawSettings is for; nothing to report.
    },
  );
  const { js } = contentScriptRegistration(settings);
  await expect.poll(() => registeredContentScriptFiles(extension.worker)).toEqual(js);
}

// The files of the registered content script, the first of which declares the settings
// (src/service-worker-navigation/settings-script.ts)
export function registeredContentScriptFiles(
  worker: Worker,
): Promise<readonly string[] | undefined> {
  return worker.evaluate(async () => {
    const [script] = await chrome.scripting.getRegisteredContentScripts();
    return script?.js;
  });
}

export function toolbarState(worker: Worker): Promise<{ badge: string; title: string }> {
  return worker.evaluate(async () => ({
    badge: await chrome.action.getBadgeText({}),
    title: await chrome.action.getTitle({}),
  }));
}

export async function removeDynamicRules(worker: Worker): Promise<void> {
  await worker.evaluate(async () => {
    const rules = await chrome.declarativeNetRequest.getDynamicRules();
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: rules.map((rule) => rule.id),
    });
  });
}

// The tooltip the extension should show, built from the catalog Chrome actually uses: macOS
// Chromium ignores LANGUAGE, so the text depends on the OS language. getMessage returns ""
// for a key the catalog lacks, so an empty message fails here instead of matching an
// equally empty tooltip line.
export async function expectedTitle(
  worker: Worker,
  problemKeys: readonly string[],
): Promise<string> {
  const keys = ["actionTitle", ...problemKeys];
  const messages = await worker.evaluate(
    (catalogKeys) => catalogKeys.map((key) => chrome.i18n.getMessage(key)),
    keys,
  );
  const missing = keys.filter((_key, index) => messages[index] === "");
  if (missing.length > 0) {
    throw new Error(`The catalog has no message for ${missing.join(", ")}`);
  }
  return messages.join("\n");
}

// The same control a user changes in chrome://extensions ("Site access").
export async function setSiteAccess(
  extension: Extension,
  access: "ON_CLICK" | "ON_ALL_SITES",
): Promise<void> {
  const page = await extension.context.newPage();
  await page.goto(`chrome://extensions/?id=${extension.id}`);
  await page.locator("select#hostAccess").selectOption(access);
  await page.close();
}
