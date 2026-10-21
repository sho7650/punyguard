// Runs URLs through the rules buildBlockRules makes, the way Chrome would, for the unit tests.
import { buildBlockRules } from "../block-rule.ts";
import { DEFAULT_SETTINGS, type Settings } from "../settings.ts";

export const WARNING_PAGE = "chrome-extension://abcdefghijklmnop/blocked.html";

// Where Chrome sends a navigation to the URL under these rules, or null when it lets it through.
// Chrome picks the matching rule with the highest priority, and at the same priority an allow
// rule wins over a redirect. It replaces only the matched part of the URL with
// regexSubstitution, where \0 is the whole match and \1 to \9 are its groups, and keeps the rest
// of the URL after it.
// The callbacks take chrome.declarativeNetRequest.Rule, a mutable type from @types/chrome.
/* oxlint-disable typescript/prefer-readonly-parameter-types */
export function redirectTarget(url: string, settings: Settings = DEFAULT_SETTINGS): string | null {
  const patterns = buildBlockRules(WARNING_PAGE, settings).map((rule) => {
    const { regexFilter } = rule.condition;
    if (regexFilter === undefined) {
      throw new Error("Expected every rule to use a regexFilter");
    }
    // buildBlockRules never sets isUrlFilterCaseSensitive, and Chrome's default for it is
    // false, so every rule matches case-insensitively.
    return { rule, pattern: new RegExp(regexFilter, "iu") };
  });
  const matching = patterns.filter(({ pattern }) => pattern.test(url));
  const topPriority = Math.max(...matching.map(({ rule }) => rule.priority ?? 1));
  const winners = matching.filter(({ rule }) => (rule.priority ?? 1) === topPriority);
  if (winners.length === 0 || winners.some(({ rule }) => rule.action.type === "allow")) {
    return null;
  }
  // Chrome may pick any of the redirects that tie, so they all have to agree.
  const targets = new Set(
    winners.map(({ rule, pattern }) => {
      const substitution = rule.action.redirect?.regexSubstitution;
      if (substitution === undefined) {
        throw new Error("Expected a rule that redirects with regexSubstitution");
      }
      return url.replace(pattern, (...match: string[]) =>
        substitution.replaceAll(/\\([0-9])/gu, (_, group: string) => match[Number(group)] ?? ""),
      );
    }),
  );
  if (targets.size !== 1) {
    throw new Error(`Matching redirects disagree: ${[...targets].join(", ")}`);
  }
  return [...targets][0] ?? null;
}
/* oxlint-enable typescript/prefer-readonly-parameter-types */
