// Stands in for the browser APIs that ensureProtection uses, for the unit tests.
import type { ProtectionDeps } from "../protection.ts";
import { DEFAULT_SETTINGS, type Settings } from "../settings.ts";

export const WARNING_PAGE = "chrome-extension://abcdefghijklmnop/blocked.html";

export interface FakeBrowserOptions {
  readonly ruleUpdate?: "succeeds" | "fails";
  // Whether the content script is registered from an earlier run, and whether Chrome accepts
  // registering or updating it now
  readonly scriptRegisteredBefore?: boolean;
  readonly scriptRegistration?: "succeeds" | "fails";
  readonly allSitesAccess?: boolean;
  readonly settings?: Settings;
}

type ContentScriptApis = Pick<
  ProtectionDeps,
  "getRegisteredContentScripts" | "registerContentScripts" | "updateContentScripts"
>;

// Chrome's errors for registering an ID twice or updating one that is not registered are not
// modeled: ensureProtection checks first and its runs never overlap, so it cannot cause them.
// The tests read which of register and update was called from the recorded calls.
function fakeContentScriptApis({
  scriptRegisteredBefore = false,
  scriptRegistration = "succeeds",
}: FakeBrowserOptions) {
  const calls = {
    registeredScripts: [] as chrome.scripting.RegisteredContentScript[],
    updatedScripts: [] as chrome.scripting.RegisteredContentScript[],
  };
  // A missing or broken file of the registration, or the extension reloading meanwhile
  const answer = (): Promise<void> =>
    scriptRegistration === "fails"
      ? Promise.reject(new Error("Could not load file"))
      : Promise.resolve();
  const apis: ContentScriptApis = {
    getRegisteredContentScripts: (ids) =>
      Promise.resolve(scriptRegisteredBefore ? ids.map((id) => ({ id, js: ["content.js"] })) : []),
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- mirrors Chrome's mutable RegisteredContentScript
    registerContentScripts: (scripts) => {
      calls.registeredScripts.push(...scripts);
      return answer();
    },
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- mirrors Chrome's mutable RegisteredContentScript
    updateContentScripts: (scripts) => {
      calls.updatedScripts.push(...scripts);
      return answer();
    },
  };
  return { apis, calls };
}

// Records what ensureProtection asked of the browser.
export function createFakeBrowser(options: FakeBrowserOptions = {}) {
  const { ruleUpdate = "succeeds", allSitesAccess = true, settings = DEFAULT_SETTINGS } = options;
  const contentScripts = fakeContentScriptApis(options);
  const calls = {
    removedRuleIds: [] as number[][],
    addedRuleIds: [] as number[][],
    ...contentScripts.calls,
    originChecks: [] as (readonly string[])[],
    badgeTexts: [] as string[],
    titles: [] as string[],
    errors: [] as { message: string; error: unknown }[],
  };
  const deps: ProtectionDeps = {
    warningPageUrl: WARNING_PAGE,
    loadSettings: () => Promise.resolve(settings),
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- mirrors Chrome's mutable UpdateRuleOptions
    updateDynamicRules: (update) => {
      calls.removedRuleIds.push([...(update.removeRuleIds ?? [])]);
      const added: number[] = [];
      for (const rule of update.addRules ?? []) {
        added.push(rule.id);
      }
      // Chrome does not care about the order of the rules, so neither do the tests.
      calls.addedRuleIds.push(added.toSorted((a, b) => a - b));
      // Chrome failing to store the dynamic rules. An invalid regex cannot be the cause: the
      // E2E tests check every rule with isRegexSupported.
      return ruleUpdate === "fails"
        ? Promise.reject(new Error("Internal error while updating dynamic rules."))
        : Promise.resolve();
    },
    ...contentScripts.apis,
    containsOrigins: (origins) => {
      calls.originChecks.push(origins);
      return Promise.resolve(allSitesAccess);
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
