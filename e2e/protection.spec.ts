// The block rule as Chrome holds it, the toolbar badge, and blocking across restarts.
import { expect, test } from "./support/fixtures.ts";
import {
  dynamicRules,
  launchExtension,
  newUserDataDir,
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
  expect(await toolbarState(extension.worker)).toEqual({ badge: "", title: "PunyGuard" });
});

test("limiting site access shows ! with the reason, and restoring it clears them", async ({
  extension,
}) => {
  await setSiteAccess(extension, "ON_CLICK");
  await expect
    .poll(() => toolbarState(extension.worker))
    .toEqual({
      badge: "!",
      title: 'PunyGuard\nBlocking is off: set site access to "On all sites".',
    });

  await setSiteAccess(extension, "ON_ALL_SITES");
  await expect
    .poll(() => toolbarState(extension.worker))
    .toEqual({ badge: "", title: "PunyGuard" });
});

test("blocking continues after the browser restarts with the same profile", async ({ server }) => {
  const userDataDir = newUserDataDir();
  const first = await launchExtension(userDataDir);
  await first.context.close();

  const second = await launchExtension(userDataDir);
  try {
    const page = await second.context.newPage();
    await page.goto(server.idnUrl("/after-restart"));

    await expect(page).toHaveURL(`${second.warningPageUrl}#${server.idnUrl("/after-restart")}`);
    expect(server.idnRequests).toEqual([]);
  } finally {
    await second.context.close();
  }
});
