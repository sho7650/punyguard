import { buildBlockRule } from "./block-rule.ts";

type ProblemMessageKey = "problemRuleNotRegistered" | "problemNoSiteAccess";
type ProtectionMessageKey = "actionTitle" | ProblemMessageKey;

// The browser APIs that ensureProtection needs, passed in so that tests can stand in for them.
export interface ProtectionDeps {
  readonly warningPageUrl: string;
  readonly updateDynamicRules: (
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- mirrors Chrome's mutable UpdateRuleOptions
    options: chrome.declarativeNetRequest.UpdateRuleOptions,
  ) => Promise<void>;
  // Whether the extension holds host access to all of these origins (chrome.permissions.contains)
  readonly containsOrigins: (origins: readonly string[]) => Promise<boolean>;
  readonly setBadgeText: (text: string) => Promise<void>;
  readonly setTitle: (title: string) => Promise<void>;
  readonly getMessage: (key: ProtectionMessageKey) => string;
  readonly logError: (message: string, error: unknown) => void;
}

async function registerBlockRule(deps: ProtectionDeps): Promise<ProblemMessageKey | null> {
  const rule = buildBlockRule(deps.warningPageUrl);
  try {
    await deps.updateDynamicRules({ removeRuleIds: [rule.id], addRules: [rule] });
    return null;
  } catch (error) {
    deps.logError("Failed to register the block rule", error);
    return "problemRuleNotRegistered";
  }
}

// DNR redirects only work with host access to the redirected URL, so restricting site access
// (for example "On click") silently stops the blocking while the rule stays registered.
// A failed check is treated as missing access: protection cannot be confirmed.
async function checkSiteAccess(deps: ProtectionDeps): Promise<ProblemMessageKey | null> {
  try {
    const hasAllSites = await deps.containsOrigins(["<all_urls>"]);
    return hasAllSites ? null : "problemNoSiteAccess";
  } catch (error) {
    deps.logError("Failed to check site access", error);
    return "problemNoSiteAccess";
  }
}

export async function ensureProtection(deps: ProtectionDeps): Promise<void> {
  const results = [await registerBlockRule(deps), await checkSiteAccess(deps)];
  const problems = results.filter((problem) => problem !== null);
  await deps.setBadgeText(problems.length === 0 ? "" : "!");
  await deps.setTitle(
    [deps.getMessage("actionTitle"), ...problems.map((key) => deps.getMessage(key))].join("\n"),
  );
}
