// The block rule as Chrome holds it, the toolbar badge, and blocking across restarts.
import { expect, test } from "./support/fixtures.ts";
import {
  dynamicRules,
  expectedTitle,
  launchExtension,
  newUserDataDir,
  removeDynamicRules,
  removeUserDataDir,
  setSiteAccess,
  toolbarState,
} from "./support/extension.ts";

test("registers one rule that RE2 accepts, and leaves the badge empty", async ({ extension }) => {
  const rules = await dynamicRules(extension.worker);
  expect(rules).toHaveLength(1);

  // Vitest runs V8's regex engine; only Chrome can tell whether RE2 takes the pattern.
  const regex = rules[0]?.condition.regexFilter ?? "";
  const { isSupported } = await extension.worker.evaluate(
    (pattern) => chrome.declarativeNetRequest.isRegexSupported({ regex: pattern }),
    regex,
  );
  expect(isSupported).toBe(true);
  expect(await toolbarState(extension.worker)).toEqual({
    badge: "",
    title: await expectedTitle(extension.worker, []),
  });
});

test("limiting site access shows ! with the reason, and restoring it clears them", async ({
  extension,
}) => {
  const limited = await expectedTitle(extension.worker, ["problemNoSiteAccess"]);
  const normal = await expectedTitle(extension.worker, []);

  await setSiteAccess(extension, "ON_CLICK");
  await expect.poll(() => toolbarState(extension.worker)).toEqual({ badge: "!", title: limited });

  await setSiteAccess(extension, "ON_ALL_SITES");
  await expect.poll(() => toolbarState(extension.worker)).toEqual({ badge: "", title: normal });
});

// Dynamic rules survive a restart, so the rule is removed first: only registering again can
// bring it back. Chromium reinstalls an extension loaded with --load-extension on every
// launch, so this restart fires onInstalled (reason "install"), not onStartup; onStartup is
// checked by hand in Phase 6 (tasks/todo.md).
test("a restart registers a lost rule again and blocking resumes", async ({ server }) => {
  const userDataDir = newUserDataDir();
  try {
    const first = await launchExtension(userDataDir);
    try {
      await removeDynamicRules(first.worker);
      expect(await dynamicRules(first.worker)).toEqual([]);
    } finally {
      await first.context.close();
    }

    // launchExtension waits until the rule is back.
    const second = await launchExtension(userDataDir);
    try {
      const page = await second.context.newPage();
      await page.goto(server.idnUrl("/after-restart"));

      await expect(page).toHaveURL(`${second.warningPageUrl}#${server.idnUrl("/after-restart")}`);
      expect(server.idnRequests).toEqual([]);
    } finally {
      await second.context.close();
    }
  } finally {
    removeUserDataDir(userDataDir);
  }
});
