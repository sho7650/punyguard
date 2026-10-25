// The options page: what it shows, and that each change is saved and applied at once.
import type { Page } from "@playwright/test";
import { dynamicRuleIds, type Extension } from "./support/extension.ts";
import { expect, test } from "./support/fixtures.ts";

async function openOptions(extension: Extension): Promise<Page> {
  const page = await extension.context.newPage();
  await page.goto(`chrome-extension://${extension.id}/options.html`);
  // The form starts unchecked, so only a checked box shows that the saved settings are loaded and
  // a click will be saved. Every test starts with IP address hosts blocked.
  await expect(page.locator("#blockIpHosts")).toBeChecked();
  return page;
}

function savedSettings(extension: Extension): Promise<unknown> {
  return extension.worker.evaluate(
    async () => (await chrome.storage.local.get("settings"))["settings"],
  );
}

test("shows the default settings: block both, do not exclude private addresses", async ({
  extension,
}) => {
  const page = await openOptions(extension);

  await expect(page.locator("#blockUserinfo")).toBeChecked();
  await expect(page.locator("#blockIpHosts")).toBeChecked();
  await expect(page.locator("#excludePrivateIps")).not.toBeChecked();
  await expect(page.locator("#excludePrivateIps")).toBeEnabled();
  await expect(page.locator("h1")).not.toBeEmpty();
});

test("a change is saved at once and the rules follow", async ({ extension }) => {
  const page = await openOptions(extension);

  await page.locator("#excludePrivateIps").check();
  await expect
    .poll(() => savedSettings(extension))
    .toEqual({
      blockUserinfo: true,
      blockIpHosts: true,
      excludePrivateIps: true,
    });
  await expect.poll(() => dynamicRuleIds(extension.worker)).toEqual(new Set([1, 2, 3, 4, 5, 6, 7]));

  await page.locator("#blockUserinfo").uncheck();
  await expect.poll(() => dynamicRuleIds(extension.worker)).toEqual(new Set([1, 3, 4, 5, 6, 8, 9]));
});

test("turning IP address blocking off greys out the exclusion and keeps its value", async ({
  extension,
}) => {
  const page = await openOptions(extension);
  await page.locator("#excludePrivateIps").check();

  await page.locator("#blockIpHosts").uncheck();
  await expect(page.locator("#excludePrivateIps")).toBeDisabled();
  await expect(page.locator("#excludePrivateIps")).toBeChecked();
  await expect.poll(() => dynamicRuleIds(extension.worker)).toEqual(new Set([1, 2, 7]));

  await page.locator("#blockIpHosts").check();
  await expect(page.locator("#excludePrivateIps")).toBeEnabled();
  await expect.poll(() => dynamicRuleIds(extension.worker)).toEqual(new Set([1, 2, 3, 4, 5, 6, 7]));
});

test("a change from another tab shows up on an open options page", async ({ extension }) => {
  const page = await openOptions(extension);
  await expect(page.locator("#blockUserinfo")).toBeChecked();

  await extension.worker.evaluate(() =>
    chrome.storage.local.set({
      settings: { blockUserinfo: false, blockIpHosts: true, excludePrivateIps: false },
    }),
  );

  await expect(page.locator("#blockUserinfo")).not.toBeChecked();
});

// Holds the result of each chrome.storage.local.get the options page makes, read at call time,
// until the test releases it. The page's module looks chrome.storage.local.get up at call time,
// so replacing the property here reaches it.
declare global {
  var heldLoads: (() => void)[];
  var loadCount: number;
  var failHeldSave: () => void;
  var saveCount: number;
}

async function holdLoads(page: Page): Promise<void> {
  await page.evaluate(() => {
    globalThis.heldLoads = [];
    globalThis.loadCount = 0;
    const storage = chrome.storage.local;
    const originalGet = storage.get.bind(storage);
    Object.defineProperty(storage, "get", {
      value: async (keys: string) => {
        const items = await originalGet(keys);
        globalThis.loadCount += 1;
        await new Promise<void>((resolve) => {
          globalThis.heldLoads.push(resolve);
        });
        return items;
      },
    });
  });
}

function loadCount(page: Page): Promise<number> {
  return page.evaluate(() => globalThis.loadCount);
}

async function releaseOldestLoad(page: Page): Promise<void> {
  await page.evaluate(() => {
    globalThis.heldLoads.shift()?.();
  });
}

async function releaseHeldLoads(page: Page): Promise<void> {
  await page.evaluate(() => {
    for (const release of globalThis.heldLoads.splice(0)) {
      release();
    }
  });
}

test("a slow reload after a save does not undo a later change", async ({ extension }) => {
  await extension.worker.evaluate(() =>
    chrome.storage.local.set({
      settings: { blockUserinfo: false, blockIpHosts: true, excludePrivateIps: false },
    }),
  );
  const page = await openOptions(extension);
  await expect(page.locator("#blockUserinfo")).not.toBeChecked();
  await holdLoads(page);

  // A: its save makes this tab reload the settings, and that load is held.
  await page.locator("#excludePrivateIps").check();
  await expect.poll(() => loadCount(page)).toBe(1);
  // B: the user turns blocking on while A's reload is still pending.
  await page.locator("#blockUserinfo").check();
  await expect.poll(() => loadCount(page)).toBe(2);
  // A's reload finishes; it read the settings saved before B.
  await releaseOldestLoad(page);
  // C: one more change, saving whatever the form shows now.
  await page.locator("#blockIpHosts").uncheck();
  await releaseHeldLoads(page);
  await expect.poll(() => loadCount(page)).toBe(3);
  await releaseHeldLoads(page);

  await expect
    .poll(() => savedSettings(extension))
    .toEqual({ blockUserinfo: true, blockIpHosts: false, excludePrivateIps: true });
  await expect(page.locator("#blockUserinfo")).toBeChecked();
});

test("a slow reload after a failed save does not undo a later change", async ({ extension }) => {
  await extension.worker.evaluate(() =>
    chrome.storage.local.set({
      settings: { blockUserinfo: false, blockIpHosts: true, excludePrivateIps: false },
    }),
  );
  const page = await openOptions(extension);
  await expect(page.locator("#blockUserinfo")).not.toBeChecked();
  await holdLoads(page);
  await page.evaluate(() => {
    const storage = chrome.storage.local;
    const originalSet = storage.set.bind(storage);
    let failNext = true;
    Object.defineProperty(storage, "set", {
      value: async (items: Record<string, unknown>) => {
        if (failNext) {
          failNext = false;
          throw new Error("simulated write failure");
        }
        await originalSet(items);
      },
    });
  });

  // A fails to save, so the page reloads the saved settings; that load is held.
  await page.locator("#excludePrivateIps").check();
  await expect(page.locator("#save-failed")).toBeVisible();
  await expect.poll(() => loadCount(page)).toBe(1);
  // B: the user turns blocking on while that reload is pending; it saves.
  await page.locator("#blockUserinfo").check();
  await expect.poll(() => loadCount(page)).toBe(2);
  await releaseOldestLoad(page);
  // C: one more change, saving whatever the form shows now.
  await page.locator("#blockIpHosts").uncheck();
  await releaseHeldLoads(page);
  await expect.poll(() => loadCount(page)).toBe(3);
  await releaseHeldLoads(page);

  await expect
    .poll(() => savedSettings(extension))
    .toEqual({ blockUserinfo: true, blockIpHosts: false, excludePrivateIps: true });
  await expect(page.locator("#save-failed")).toBeHidden();
});

// Holds the first chrome.storage.local.set the options page makes until the test fails it with
// failHeldSave. Later writes go through at once.
async function holdFirstSave(page: Page): Promise<void> {
  await page.evaluate(() => {
    globalThis.saveCount = 0;
    const storage = chrome.storage.local;
    const originalSet = storage.set.bind(storage);
    Object.defineProperty(storage, "set", {
      value: async (items: Record<string, unknown>) => {
        globalThis.saveCount += 1;
        if (globalThis.saveCount === 1) {
          await new Promise<void>((_resolve, reject) => {
            globalThis.failHeldSave = () => {
              reject(new Error("simulated write failure"));
            };
          });
        }
        await originalSet(items);
      },
    });
  });
}

function saveCount(page: Page): Promise<number> {
  return page.evaluate(() => globalThis.saveCount);
}

test("an earlier save that fails after a later one succeeded shows no failure", async ({
  extension,
}) => {
  const page = await openOptions(extension);
  await holdFirstSave(page);

  // A: its write is held.
  await page.locator("#excludePrivateIps").check();
  await expect.poll(() => saveCount(page)).toBe(1);
  // B: saves the whole form, A's change included, and succeeds.
  await page.locator("#blockUserinfo").uncheck();
  await expect
    .poll(() => savedSettings(extension))
    .toEqual({ blockUserinfo: false, blockIpHosts: true, excludePrivateIps: true });
  // A's write fails only now.
  const failureLogged = page.waitForEvent("console", (message) =>
    message.text().startsWith("Failed to save the settings"),
  );
  await page.evaluate(() => {
    globalThis.failHeldSave();
  });
  await failureLogged;

  await expect(page.locator("#save-failed")).toBeHidden();
  await expect(page.locator("#blockUserinfo")).not.toBeChecked();
  await expect(page.locator("#excludePrivateIps")).toBeChecked();
  await expect
    .poll(() => savedSettings(extension))
    .toEqual({ blockUserinfo: false, blockIpHosts: true, excludePrivateIps: true });
});
