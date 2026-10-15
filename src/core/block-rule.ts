const BLOCK_RULE_ID = 1;

export function buildBlockRule(warningPageUrl: string): chrome.declarativeNetRequest.Rule {
  return {
    id: BLOCK_RULE_ID,
    condition: {
      // A label starts after "://", "." or "@" (userinfo). Chrome evaluates this as RE2,
      // so no lookarounds or backreferences; the E2E tests check it with isRegexSupported.
      // The "^" anchor matters: regexSubstitution replaces only the matched part, so the
      // match must start at the scheme for the original URL to land whole in the fragment.
      regexFilter: "^https?://(?:[^/?#]*[.@])?xn--",
      resourceTypes: ["main_frame", "sub_frame"],
    },
    action: {
      type: "redirect",
      redirect: { regexSubstitution: `${warningPageUrl}#\\0` },
    },
  };
}
