import { buildBlockRule } from "./block-rule.ts";

// Every message key ensureProtection looks up; src/locales.test.ts checks that both catalogs
// define them.
export const PROTECTION_MESSAGE_KEYS = [
  "actionTitle",
  "problemRuleNotRegistered",
  "problemNoSiteAccess",
] as const;
type ProtectionMessageKey = (typeof PROTECTION_MESSAGE_KEYS)[number];
type ProblemMessageKey = Exclude<ProtectionMessageKey, "actionTitle">;

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

// Chrome can fire several events close together (site access switched back and forth), and
// overlapping checks would set the badge in whichever order they finish. Queuing them makes
// the badge show the latest check. A failed run does not stop the ones after it.
export function createProtector(deps: ProtectionDeps): () => Promise<void> {
  let previous: Promise<void> = Promise.resolve();
  return () => {
    const run = previous.then(() => ensureProtection(deps));
    previous = run.catch(() => {
      // The caller of this run gets the error; the queue only waits for it to settle.
    });
    return run;
  };
}
