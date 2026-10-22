// ensureProtection keeping the content script registered (ADR-0004). The block rules, site
// access and the tooltip are in protection.test.ts.
import { describe, expect, test } from "vitest";
import { contentScriptRegistration } from "./service-worker-navigation/settings-script.ts";
import { ensureProtection } from "./protection.ts";
import { createFakeBrowser } from "./test-support/fake-browser.ts";

describe("ensureProtection and the content script", () => {
  test("registers the content script for the settings when it is not registered yet", async () => {
    const settings = { blockUserinfo: false, blockIpHosts: true, excludePrivateIps: true };
    const { deps, calls } = createFakeBrowser({ settings });

    await ensureProtection(deps);

    expect(calls.registeredScripts).toEqual([contentScriptRegistration(settings)]);
    expect(calls.updatedScripts).toEqual([]);
    expect(calls.badgeTexts).toEqual([""]);
  });

  // Unregistering first would leave navigations unguarded until it is registered again, so
  // there is no unregistering at all.
  test("updates the registered content script in place for the settings", async () => {
    const settings = { blockUserinfo: true, blockIpHosts: false, excludePrivateIps: false };
    const { deps, calls } = createFakeBrowser({ settings, scriptRegisteredBefore: true });

    await ensureProtection(deps);

    expect(calls.updatedScripts).toEqual([contentScriptRegistration(settings)]);
    expect(calls.registeredScripts).toEqual([]);
    expect(calls.badgeTexts).toEqual([""]);
  });
});

describe("ensureProtection when the content script cannot be registered", () => {
  test.each([
    { name: "registered", scriptRegisteredBefore: false },
    { name: "updated", scriptRegisteredBefore: true },
  ] as const)(
    "shows ! with the cause and logs the error, without throwing, when it cannot be $name",
    async ({ scriptRegisteredBefore }) => {
      const { deps, calls } = createFakeBrowser({
        scriptRegisteredBefore,
        scriptRegistration: "fails",
      });

      await expect(ensureProtection(deps)).resolves.toBeUndefined();

      expect(calls.badgeTexts).toEqual(["!"]);
      expect(calls.titles).toEqual(["<actionTitle>\n<problemContentScriptNotRegistered>"]);
      expect(calls.errors).toEqual([
        {
          message: "Failed to register the content script",
          error: new Error("Could not load file"),
        },
      ]);
    },
  );
});

describe("ensureProtection when several things fail", () => {
  test("shows a single ! with every cause when the rule and the content script both fail", async () => {
    const { deps, calls } = createFakeBrowser({
      ruleUpdate: "fails",
      scriptRegistration: "fails",
      allSitesAccess: false,
    });

    await ensureProtection(deps);

    expect(calls.badgeTexts).toEqual(["!"]);
    expect(calls.titles).toEqual([
      "<actionTitle>\n<problemRuleNotRegistered>\n<problemContentScriptNotRegistered>\n<problemNoSiteAccess>",
    ]);
  });
});
