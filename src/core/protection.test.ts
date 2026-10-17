import { describe, expect, test } from "vitest";
import { createProtector, ensureProtection, type ProtectionDeps } from "./protection.ts";
import { DEFAULT_SETTINGS, type Settings } from "./settings.ts";

const WARNING_PAGE = "chrome-extension://abcdefghijklmnop/blocked.html";

interface FakeBrowserOptions {
  readonly ruleUpdate?: "succeeds" | "fails";
  readonly allSitesAccess?: boolean | "check fails";
  readonly settings?: Settings;
}

// Stands in for the browser APIs and records what ensureProtection asked of them.
function createFakeBrowser({
  ruleUpdate = "succeeds",
  allSitesAccess = true,
  settings = DEFAULT_SETTINGS,
}: FakeBrowserOptions = {}) {
  const calls = {
    removedRuleIds: [] as number[][],
    addedRuleIds: [] as number[][],
    originChecks: [] as (readonly string[])[],
    badgeTexts: [] as string[],
    titles: [] as string[],
    errors: [] as { message: string; error: unknown }[],
  };
  const deps: ProtectionDeps = {
    warningPageUrl: WARNING_PAGE,
    loadSettings: () => Promise.resolve(settings),
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- mirrors Chrome's mutable UpdateRuleOptions
    updateDynamicRules: (options) => {
      calls.removedRuleIds.push([...(options.removeRuleIds ?? [])]);
      const added: number[] = [];
      for (const rule of options.addRules ?? []) {
        added.push(rule.id);
      }
      // Chrome does not care about the order of the rules, so neither do the tests.
      calls.addedRuleIds.push(added.toSorted((a, b) => a - b));
      return ruleUpdate === "fails"
        ? Promise.reject(new Error("Invalid regex"))
        : Promise.resolve();
    },
    containsOrigins: (origins) => {
      calls.originChecks.push(origins);
      return allSitesAccess === "check fails"
        ? Promise.reject(new Error("Permission check failed"))
        : Promise.resolve(allSitesAccess);
    },
    setBadgeText: (text) => {
      calls.badgeTexts.push(text);
      return Promise.resolve();
    },
    setTitle: (title) => {
      calls.titles.push(title);
      return Promise.resolve();
    },
    getMessage: (key) => `<${key}>`,
    logError: (message, error) => {
      calls.errors.push({ message, error });
    },
  };
  return { deps, calls };
}

describe("ensureProtection when protection works", () => {
  test("replaces the block rules in one update and clears the badge", async () => {
    const { deps, calls } = createFakeBrowser();

    await ensureProtection(deps);

    expect(calls.removedRuleIds).toEqual([[1, 2, 3, 4, 5, 6, 7, 8, 9]]);
    expect(calls.addedRuleIds).toEqual([[1, 2, 3, 7]]);
    expect(calls.originChecks).toEqual([["<all_urls>"]]);
    expect(calls.badgeTexts).toEqual([""]);
    expect(calls.titles).toEqual(["<actionTitle>"]);
    expect(calls.errors).toEqual([]);
  });
});

describe("ensureProtection with settings the user loosened: rules", () => {
  test("registers only the rules the settings leave on, removing every rule first", async () => {
    const { deps, calls } = createFakeBrowser({
      settings: { blockUserinfo: false, blockIpHosts: true, excludePrivateIps: true },
    });

    await ensureProtection(deps);

    expect(calls.removedRuleIds).toEqual([[1, 2, 3, 4, 5, 6, 7, 8, 9]]);
    expect(calls.addedRuleIds).toEqual([[1, 3, 4, 5, 6, 8, 9]]);
  });
});

describe("ensureProtection with settings the user loosened: tooltip", () => {
  test.each([
    {
      name: "userinfo blocking is off",
      settings: { blockUserinfo: false, blockIpHosts: true, excludePrivateIps: false },
      title: "<actionTitle>\n<noticeUserinfoOff>",
    },
    {
      name: "private addresses are excluded",
      settings: { blockUserinfo: true, blockIpHosts: true, excludePrivateIps: true },
      title: "<actionTitle>\n<noticePrivateIpsExcluded>",
    },
    {
      // The exclusion has no effect while IP address hosts are not blocked at all.
      name: "IP address blocking is off, with private addresses excluded",
      settings: { blockUserinfo: true, blockIpHosts: false, excludePrivateIps: true },
      title: "<actionTitle>\n<noticeIpHostsOff>",
    },
    {
      name: "both are off",
      settings: { blockUserinfo: false, blockIpHosts: false, excludePrivateIps: false },
      title: "<actionTitle>\n<noticeUserinfoOff>\n<noticeIpHostsOff>",
    },
  ] as const)("adds a line, without !, when $name", async ({ settings, title }) => {
    const { deps, calls } = createFakeBrowser({ settings });

    await ensureProtection(deps);

    expect(calls.badgeTexts).toEqual([""]);
    expect(calls.titles).toEqual([title]);
  });

  test("lists the problems before the loosened settings", async () => {
    const { deps, calls } = createFakeBrowser({
      allSitesAccess: false,
      settings: { blockUserinfo: false, blockIpHosts: true, excludePrivateIps: false },
    });

    await ensureProtection(deps);

    expect(calls.badgeTexts).toEqual(["!"]);
    expect(calls.titles).toEqual(["<actionTitle>\n<problemNoSiteAccess>\n<noticeUserinfoOff>"]);
  });
});

describe("ensureProtection when protection is off", () => {
  test("shows ! with the cause and logs the error, without throwing, when the rule cannot be registered", async () => {
    const { deps, calls } = createFakeBrowser({ ruleUpdate: "fails" });

    await expect(ensureProtection(deps)).resolves.toBeUndefined();

    expect(calls.badgeTexts).toEqual(["!"]);
    expect(calls.titles).toEqual(["<actionTitle>\n<problemRuleNotRegistered>"]);
    expect(calls.errors).toEqual([
      { message: "Failed to register the block rule", error: new Error("Invalid regex") },
    ]);
  });

  test("shows ! with the cause when the rule is registered but site access is not on all sites", async () => {
    const { deps, calls } = createFakeBrowser({ allSitesAccess: false });

    await ensureProtection(deps);

    expect(calls.badgeTexts).toEqual(["!"]);
    expect(calls.titles).toEqual(["<actionTitle>\n<problemNoSiteAccess>"]);
  });

  test("shows a single ! with both causes when the rule fails and site access is restricted", async () => {
    const { deps, calls } = createFakeBrowser({ ruleUpdate: "fails", allSitesAccess: false });

    await ensureProtection(deps);

    expect(calls.badgeTexts).toEqual(["!"]);
    expect(calls.titles).toEqual([
      "<actionTitle>\n<problemRuleNotRegistered>\n<problemNoSiteAccess>",
    ]);
  });

  test("treats a failed site access check as missing access and logs it, without throwing", async () => {
    const { deps, calls } = createFakeBrowser({ allSitesAccess: "check fails" });

    await expect(ensureProtection(deps)).resolves.toBeUndefined();

    expect(calls.badgeTexts).toEqual(["!"]);
    expect(calls.titles).toEqual(["<actionTitle>\n<problemNoSiteAccess>"]);
    expect(calls.errors).toEqual([
      { message: "Failed to check site access", error: new Error("Permission check failed") },
    ]);
  });
});

describe("createProtector", () => {
  test("runs one check at a time, so the badge shows the result of the latest check", async () => {
    const { deps, calls } = createFakeBrowser();
    // The first check (site access restricted) answers only after the second one has been asked for.
    const answers = [Promise.withResolvers<boolean>(), Promise.withResolvers<boolean>()];
    let checks = 0;
    const protect = createProtector({
      ...deps,
      containsOrigins: (origins) => {
        calls.originChecks.push(origins);
        const answer = answers[checks];
        checks += 1;
        return answer === undefined ? Promise.resolve(true) : answer.promise;
      },
    });

    const first = protect();
    const second = protect();
    answers[1]?.resolve(true);
    // Let any run that is not waiting on the first check finish before the first one answers.
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
    answers[0]?.resolve(false);
    await Promise.all([first, second]);

    expect(calls.badgeTexts).toEqual(["!", ""]);
  });

  test("keeps running checks after one of them throws", async () => {
    const { deps, calls } = createFakeBrowser();
    let badgeUpdates = 0;
    const protect = createProtector({
      ...deps,
      setBadgeText: (text) => {
        badgeUpdates += 1;
        calls.badgeTexts.push(text);
        return badgeUpdates === 1 ? Promise.reject(new Error("No tab")) : Promise.resolve();
      },
    });

    await expect(protect()).rejects.toThrow("No tab");
    await protect();

    expect(calls.badgeTexts).toEqual(["", ""]);
  });
});

describe("createProtector and settings", () => {
  test("reads the settings again on every run, so a change applies on the next run", async () => {
    const { deps, calls } = createFakeBrowser();
    const saved: Settings[] = [
      DEFAULT_SETTINGS,
      { blockUserinfo: false, blockIpHosts: false, excludePrivateIps: false },
    ];
    let runs = 0;
    const protect = createProtector({
      ...deps,
      loadSettings: () => {
        const settings = saved[runs] ?? DEFAULT_SETTINGS;
        runs += 1;
        return Promise.resolve(settings);
      },
    });

    await protect();
    await protect();

    expect(calls.addedRuleIds).toEqual([
      [1, 2, 3, 7],
      [1, 8],
    ]);
  });
});
