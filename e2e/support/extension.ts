/// <reference types="chrome" />
// Starts Chromium with the built extension (dist/) loaded and waits until the block rule is in.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium, expect, type BrowserContext, type Worker } from "@playwright/test";
import { ASCII_HOST, IDN_HOST } from "./server.ts";

const DIST = path.resolve(import.meta.dirname, "../../dist");

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

export async function launchExtension(
  userDataDir: string,
  env: Readonly<Record<string, string>> = {},
): Promise<Extension> {
  const context = await chromium.launchPersistentContext(userDataDir, {
    // Only the new headless mode (or a headed browser) loads extensions; the default
    // headless shell does not.
    channel: "chromium",
    args: [
      `--disable-extensions-except=${DIST}`,
      `--load-extension=${DIST}`,
      `--host-resolver-rules=MAP ${IDN_HOST} 127.0.0.1, MAP ${ASCII_HOST} 127.0.0.1`,
    ],
    env: { ...process.env, ...env },
  });
  try {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
    // onInstalled registers the rule asynchronously after the worker starts.
    await expect.poll(async () => (await dynamicRules(worker)).length).toBe(1);
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
