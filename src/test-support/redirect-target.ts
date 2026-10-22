// Runs URLs through the rules buildBlockRules makes, the way Chrome would, for the unit tests.
import { buildBlockRules } from "../blocking/block-rule.ts";
import { DEFAULT_SETTINGS, type Settings } from "../settings/settings.ts";
import { WARNING_PAGE } from "./warning-page.ts";

// What Chrome does with a navigation to the URL under these rules: the IDs of the rules that
// decide it (the allow rules when one wins, the tying redirects otherwise, none when nothing
// matches) and where it sends the navigation, or null when it lets it through.
export interface RuleDecision {
  readonly ruleIds: readonly number[];
  readonly target: string | null;
}

// Chrome picks the matching rule with the highest priority, and at the same priority an allow
// rule wins over a redirect. It replaces only the matched part of the URL with
// regexSubstitution, where \0 is the whole match and \1 to \9 are its groups, and keeps the rest
// of the URL after it.
// The callbacks take chrome.declarativeNetRequest.Rule, a mutable type from @types/chrome.
/* oxlint-disable typescript/prefer-readonly-parameter-types */
export function decideByRules(url: string, settings: Settings = DEFAULT_SETTINGS): RuleDecision {
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
  const allows = winners.filter(({ rule }) => rule.action.type === "allow");
  if (winners.length === 0 || allows.length > 0) {
    return { ruleIds: allows.map(({ rule }) => rule.id), target: null };
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
  return { ruleIds: winners.map(({ rule }) => rule.id), target: [...targets][0] ?? null };
}
/* oxlint-enable typescript/prefer-readonly-parameter-types */

// Where Chrome sends a navigation to the URL under these rules, or null when it lets it through.
export function redirectTarget(url: string, settings: Settings = DEFAULT_SETTINGS): string | null {
  return decideByRules(url, settings).target;
}
