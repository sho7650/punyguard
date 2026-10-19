import { BLOCK_RULE_IDS, buildBlockRules } from "./block-rule.ts";
import { contentScriptRegistration } from "./content-script.ts";
import type { Settings } from "./settings.ts";

// Every message key ensureProtection looks up; src/locales.test.ts checks that both catalogs
// define them.
export const PROTECTION_MESSAGE_KEYS = [
  "actionTitle",
  "problemRuleNotRegistered",
  "problemNoSiteAccess",
  "problemContentScriptNotRegistered",
  "noticeUserinfoOff",
  "noticeIpHostsOff",
  "noticePrivateIpsExcluded",
] as const;
type ProtectionMessageKey = (typeof PROTECTION_MESSAGE_KEYS)[number];
type ProblemMessageKey =
  | "problemRuleNotRegistered"
  | "problemContentScriptNotRegistered"
  | "problemNoSiteAccess";
type NoticeMessageKey = "noticeUserinfoOff" | "noticeIpHostsOff" | "noticePrivateIpsExcluded";

// The browser APIs that ensureProtection needs, passed in so that tests can stand in for them.
export interface ProtectionDeps {
  readonly warningPageUrl: string;
  // Never rejects: unusable settings fall back to the defaults (loadSettings)
  readonly loadSettings: () => Promise<Settings>;
  readonly updateDynamicRules: (
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- mirrors Chrome's mutable UpdateRuleOptions
    options: chrome.declarativeNetRequest.UpdateRuleOptions,
  ) => Promise<void>;
  // chrome.scripting: getRegisteredContentScripts({ ids }), registerContentScripts and
  // updateContentScripts
  readonly getRegisteredContentScripts: (
    ids: readonly string[],
  ) => Promise<readonly chrome.scripting.RegisteredContentScript[]>;
  readonly registerContentScripts: (
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- mirrors Chrome's mutable RegisteredContentScript
    scripts: readonly chrome.scripting.RegisteredContentScript[],
  ) => Promise<void>;
  readonly updateContentScripts: (
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- mirrors Chrome's mutable RegisteredContentScript
    scripts: readonly chrome.scripting.RegisteredContentScript[],
  ) => Promise<void>;
  // Whether the extension holds host access to all of these origins (chrome.permissions.contains)
  readonly containsOrigins: (origins: readonly string[]) => Promise<boolean>;
  readonly setBadgeText: (text: string) => Promise<void>;
  readonly setTitle: (title: string) => Promise<void>;
  readonly getMessage: (key: ProtectionMessageKey) => string;
  readonly logError: (message: string, error: unknown) => void;
}

async function registerBlockRules(
  deps: ProtectionDeps,
  settings: Settings,
): Promise<ProblemMessageKey | null> {
  const rules = buildBlockRules(deps.warningPageUrl, settings);
  try {
    await deps.updateDynamicRules({ removeRuleIds: [...BLOCK_RULE_IDS], addRules: rules });
    return null;
  } catch (error) {
    deps.logError("Failed to register the block rule", error);
    return "problemRuleNotRegistered";
  }
}

// Registering an ID that is already registered fails, so an earlier registration is updated
// in place. It is never unregistered first: navigations in between would go unguarded.
// The check cannot be outdated by the time register or update runs: createProtector runs one
// check at a time, and a run cut off after registering is followed by one that finds the
// script and updates it. getRegisteredContentScripts has no error of its own, and register and
// update do not check site access (that only limits where Chrome injects). The registration
// itself is fixed and valid (contentScriptRegistration). So the catch is for
// what can fail: a file of the registration missing or not UTF-8, or the extension being
// reloaded or disabled meanwhile.
async function registerContentScript(
  deps: ProtectionDeps,
  settings: Settings,
): Promise<ProblemMessageKey | null> {
  const script = contentScriptRegistration(settings);
  try {
    const registered = await deps.getRegisteredContentScripts([script.id]);
    await (registered.length > 0
      ? deps.updateContentScripts([script])
      : deps.registerContentScripts([script]));
    return null;
  } catch (error) {
    deps.logError("Failed to register the content script", error);
    return "problemContentScriptNotRegistered";
  }
}

// DNR redirects only work with host access to the redirected URL, so restricting site access
// (for example "On click") silently stops the blocking while the rule stays registered.
// No catch: permissions.contains rejects only for invalid arguments or while the browser shuts
// down, and "<all_urls>" is fixed. Its docs list no errors, and under "On click" it resolves
// false rather than rejecting (Chromium's source, and 20 of 20 calls resolved, 2026-10-19).
async function checkSiteAccess(deps: ProtectionDeps): Promise<ProblemMessageKey | null> {
  const hasAllSites = await deps.containsOrigins(["<all_urls>"]);
  return hasAllSites ? null : "problemNoSiteAccess";
}

// What the user loosened. These are choices, not faults, so they go in the tooltip without the
// ! badge (ADR-0003). The exclusion has no effect while IP address hosts are not blocked.
function findNotices(settings: Settings): NoticeMessageKey[] {
  return [
    ...(settings.blockUserinfo ? [] : (["noticeUserinfoOff"] as const)),
    ...(settings.blockIpHosts ? [] : (["noticeIpHostsOff"] as const)),
    ...(settings.blockIpHosts && settings.excludePrivateIps
      ? (["noticePrivateIpsExcluded"] as const)
      : []),
  ];
}

// Never rejects: loadSettings never rejects, the rule registration, the content script
// registration and the site access check each handle their own failures, and setBadgeText and
// setTitle without a tabId fail only while the browser shuts down (Chromium's source, and 20 of
// 20 calls of each resolved, 2026-10-19).
export async function ensureProtection(deps: ProtectionDeps): Promise<void> {
  const settings = await deps.loadSettings();
  const results = [
    await registerBlockRules(deps, settings),
    await registerContentScript(deps, settings),
    await checkSiteAccess(deps),
  ];
  const problems = results.filter((problem) => problem !== null);
  await deps.setBadgeText(problems.length === 0 ? "" : "!");
  const lines = [...problems, ...findNotices(settings)].map((key) => deps.getMessage(key));
  await deps.setTitle([deps.getMessage("actionTitle"), ...lines].join("\n"));
}

// Chrome can fire several events close together (site access switched back and forth), and
// overlapping checks would set the badge in whichever order they finish. Queuing them makes
// the badge show the latest check. ensureProtection never rejects, so no run can stop the
// queue.
export function createProtector(deps: ProtectionDeps): () => Promise<void> {
  let previous: Promise<void> = Promise.resolve();
  return () => {
    previous = previous.then(() => ensureProtection(deps));
    return previous;
  };
}
