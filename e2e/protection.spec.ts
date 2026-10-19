// The block rules as Chrome holds them, the toolbar badge and tooltip, and blocking across
// restarts.
import { buildBlockRules } from "../src/core/block-rule.ts";
import { expect, test } from "./support/fixtures.ts";
import {
  dynamicRules,
  expectedTitle,
  launchExtension,
  newUserDataDir,
  removeDynamicRules,
  removeUserDataDir,
  saveRawSettings,
  saveSettings,
  setSiteAccess,
  toolbarState,
} from "./support/extension.ts";

test("registers the default rules and leaves the badge empty", async ({ extension }) => {
  // launchExtension (support/extension.ts) already waits until the default rules are registered.
  expect(await toolbarState(extension.worker)).toEqual({
    badge: "",
    title: await expectedTitle(extension.worker, []),
  });
});

// Vitest runs V8's regex engine; only Chrome can tell whether RE2 takes a pattern, including
// its size limit. The allow rule differs with the userinfo setting, so every combination counts.
test("RE2 accepts every rule under every combination of settings", async ({ extension }) => {
  // Every rule from buildBlockRules sets regexFilter; ?? "" only satisfies the optional type.
  const patterns = new Set(
    [true, false].flatMap((blockUserinfo) =>
      [true, false].flatMap((blockIpHosts) =>
        [true, false].flatMap((excludePrivateIps) =>
          buildBlockRules(extension.warningPageUrl, {
            blockUserinfo,
            blockIpHosts,
            excludePrivateIps,
          }).map((rule) => rule.condition.regexFilter ?? ""),
        ),
      ),
    ),
  );

  const unsupported = await extension.worker.evaluate(
    async (regexes) => {
      const results = await Promise.all(
        regexes.map((regex) => chrome.declarativeNetRequest.isRegexSupported({ regex })),
      );
      // results has one entry per regex; ?? only satisfies noUncheckedIndexedAccess.
      return regexes.filter((_regex, index) => !(results[index]?.isSupported ?? false));
    },
    [...patterns],
  );

  // IDN, userinfo, IP address hosts, three allow rules with and without userinfo, and the
  // password rules for userinfo, IDN hosts and IP address hosts
  expect(patterns.size).toBe(12);
  expect(unsupported).toEqual([]);
});

test("loosened settings add tooltip lines without !, and take effect at once", async ({
  extension,
}) => {
  await saveSettings(
    extension,
    { blockUserinfo: false, blockIpHosts: true, excludePrivateIps: true },
    [1, 3, 4, 5, 6, 8, 9],
  );
  await expect
    .poll(() => toolbarState(extension.worker))
    .toEqual({
      badge: "",
      title: await expectedTitle(extension.worker, [
        "noticeUserinfoOff",
        "noticePrivateIpsExcluded",
      ]),
    });

  await saveSettings(
    extension,
    { blockUserinfo: true, blockIpHosts: false, excludePrivateIps: true },
    [1, 2, 7],
  );
  await expect
    .poll(() => toolbarState(extension.worker))
    .toEqual({
      badge: "",
      title: await expectedTitle(extension.worker, ["noticeIpHostsOff"]),
    });
});

test("broken settings fall back to blocking everything, with an error in the console", async ({
  extension,
}) => {
  const errors: string[] = [];
  extension.context.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(message.text());
    }
  });
  await saveSettings(
    extension,
    { blockUserinfo: false, blockIpHosts: false, excludePrivateIps: false },
    [1, 8],
  );

  await saveRawSettings(
    extension,
    { blockUserinfo: "broken", blockIpHosts: false, excludePrivateIps: true },
    [1, 2, 3, 7],
  );

  await expect
    .poll(() => toolbarState(extension.worker))
    .toEqual({
      badge: "",
      title: await expectedTitle(extension.worker, []),
    });
  await expect
    .poll(() => errors)
    .toContainEqual(expect.stringContaining("The saved settings are broken"));
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

// Dynamic rules survive a restart, so the rules are removed first: only registering again can
// bring them back. Chromium reinstalls an extension loaded with --load-extension on every
// launch, so this restart fires onInstalled (reason "install"), not onStartup; onStartup is
// checked by hand in Phase 6 (tasks/todo.md).
test("a restart registers lost rules again and blocking resumes", async ({ server }) => {
  const userDataDir = newUserDataDir();
  try {
    const first = await launchExtension(userDataDir);
    try {
      await removeDynamicRules(first.worker);
      expect(await dynamicRules(first.worker)).toEqual([]);
    } finally {
      await first.context.close();
    }

    // launchExtension waits until the rules are back.
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
