// The options page: what it shows, and that each change is saved and applied at once.
import type { Page } from "@playwright/test";
import { dynamicRuleIds, type Extension } from "./support/extension.ts";
import { expect, test } from "./support/fixtures.ts";

async function openOptions(extension: Extension): Promise<Page> {
  const page = await extension.context.newPage();
  await page.goto(`chrome-extension://${extension.id}/options.html`);
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
