import { describe, expect, test } from "vitest";
import { buildBlockRule } from "./block-rule.ts";
import { createProtector, ensureProtection, type ProtectionDeps } from "./protection.ts";

const WARNING_PAGE = "chrome-extension://abcdefghijklmnop/blocked.html";

interface FakeBrowserOptions {
  readonly ruleUpdate?: "succeeds" | "fails";
  readonly allSitesAccess?: boolean | "check fails";
}

// Stands in for the browser APIs and records what ensureProtection asked of them.
function createFakeBrowser({
  ruleUpdate = "succeeds",
  allSitesAccess = true,
}: FakeBrowserOptions = {}) {
  const calls = {
    ruleUpdates: [] as chrome.declarativeNetRequest.UpdateRuleOptions[],
    originChecks: [] as (readonly string[])[],
    badgeTexts: [] as string[],
    titles: [] as string[],
    errors: [] as { message: string; error: unknown }[],
  };
  const deps: ProtectionDeps = {
    warningPageUrl: WARNING_PAGE,
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- mirrors Chrome's mutable UpdateRuleOptions
    updateDynamicRules: (options) => {
      calls.ruleUpdates.push(options);
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
  test("replaces the block rule in one update and clears the badge", async () => {
    const { deps, calls } = createFakeBrowser();

    await ensureProtection(deps);

    expect(calls.ruleUpdates).toEqual([
      { removeRuleIds: [1], addRules: [buildBlockRule(WARNING_PAGE)] },
    ]);
    expect(calls.originChecks).toEqual([["<all_urls>"]]);
    expect(calls.badgeTexts).toEqual([""]);
    expect(calls.titles).toEqual(["<actionTitle>"]);
    expect(calls.errors).toEqual([]);
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
