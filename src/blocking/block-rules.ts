import {
  IPV4_PATTERN,
  IPV6_PATTERN,
  PRIVATE_IPV4_PATTERN,
  PRIVATE_IPV6_PATTERN,
  PRIVATE_MAPPED_IPV4_PATTERN,
} from "./ip-address.ts";
import { MASKED_PASSWORD } from "./password-mask.ts";
import type { Settings } from "../settings/settings.ts";

const IDN_RULE_ID = 1;
const USERINFO_RULE_ID = 2;
const IP_HOST_RULE_ID = 3;
const PRIVATE_IPV4_RULE_ID = 4;
const PRIVATE_IPV6_RULE_ID = 5;
const PRIVATE_MAPPED_IPV4_RULE_ID = 6;
const USERINFO_PASSWORD_RULE_ID = 7;
const IDN_PASSWORD_RULE_ID = 8;
const IP_HOST_PASSWORD_RULE_ID = 9;

// A URL with a password is redirected by its password rule, not by the plain one, so the
// password rules sit above the plain redirects (priority 1). The allow rules sit above both.
const PASSWORD_PRIORITY = 2;
const ALLOW_PRIORITY = 3;

// Every ID buildBlockRules can use. Registering removes all of them first, so a rule that the
// current settings leave out does not linger from earlier settings.
export const BLOCK_RULE_IDS: readonly number[] = [
  IDN_RULE_ID,
  USERINFO_RULE_ID,
  IP_HOST_RULE_ID,
  PRIVATE_IPV4_RULE_ID,
  PRIVATE_IPV6_RULE_ID,
  PRIVATE_MAPPED_IPV4_RULE_ID,
  USERINFO_PASSWORD_RULE_ID,
  IDN_PASSWORD_RULE_ID,
  IP_HOST_PASSWORD_RULE_ID,
];

// A document in an <object> or an <embed> is requested as "object", not as "sub_frame".
const RESOURCE_TYPES: NonNullable<chrome.declarativeNetRequest.RuleCondition["resourceTypes"]> = [
  "main_frame",
  "sub_frame",
  "object",
];

// Chrome evaluates regexFilter as RE2, so no lookarounds or backreferences; the E2E tests check
// every rule with isRegexSupported. The "^" anchor matters: regexSubstitution replaces only
// the matched part, so the match must start at the scheme for the original URL to land whole
// in the fragment.
function redirectRule(
  id: number,
  regexFilter: string,
  warningPageUrl: string,
): chrome.declarativeNetRequest.Rule {
  return {
    id,
    condition: { regexFilter, resourceTypes: RESOURCE_TYPES },
    action: {
      type: "redirect",
      redirect: { regexSubstitution: `${warningPageUrl}#\\0` },
    },
  };
}

// The redirect target ends up in the warning page's address bar and in the browser history,
// where the warning page cannot take a password back out, so the password is masked on the
// way. Chrome percent-encodes any ":" inside the user name or the password, so the first ":"
// in the userinfo is the separator, and an empty password leaves no ":" at all. The host part
// is matched again so that the rule redirects exactly the URLs its plain rule does.
function passwordRule(
  id: number,
  hostPattern: string,
  warningPageUrl: string,
): chrome.declarativeNetRequest.Rule {
  return {
    id,
    priority: PASSWORD_PRIORITY,
    condition: {
      regexFilter: `^(https?://[^/@:]*):[^/@]*@(${hostPattern})`,
      resourceTypes: RESOURCE_TYPES,
    },
    action: {
      type: "redirect",
      redirect: { regexSubstitution: `${warningPageUrl}#\\1:${MASKED_PASSWORD}@\\2` },
    },
  };
}

// Chrome matches the rules against its canonical URL, which for http(s) always has a "/" right
// after host[:port]. A raw "/", "?" or "#" ends the host part, and those characters inside the
// userinfo are percent-encoded, so the authority always ends at the first "/" and the patterns
// here need not look for "?" or "#" (Chromium's url_canon_stdurl.cc and url_parse.cc, the
// declarativeNetRequest docs' example http://abc.xn--p1ai/?q=..., and a run with 14 kinds of
// URL, 2026-10-19).
const USERINFO = "(?:[^/@]*@)?";

// Looks for a label that starts with xn--. The match runs on to the end of the authority
// without crossing an "@", so an xn-- inside the userinfo cannot pass for the host.
const IDN_HOST_PATTERN = "(?:[^/@.]*\\.)*xn--[^/@]*/";

// Like the IDN pattern, the host is matched up to the end of the authority (after an optional
// port), so an address inside the userinfo cannot pass for the host.
const IP_HOST_PATTERN = `(?:${IPV4_PATTERN}|${IPV6_PATTERN})(?::[0-9]+)?/`;

// A rule that blocks by the host, whatever userinfo comes before it, and the password rule that
// goes with it.
interface HostRule {
  readonly id: number;
  readonly passwordId: number;
  readonly hostPattern: string;
}

const IDN_HOST_RULE: HostRule = {
  id: IDN_RULE_ID,
  passwordId: IDN_PASSWORD_RULE_ID,
  hostPattern: IDN_HOST_PATTERN,
};

const IP_HOST_RULE: HostRule = {
  id: IP_HOST_RULE_ID,
  passwordId: IP_HOST_PASSWORD_RULE_ID,
  hostPattern: IP_HOST_PATTERN,
};

// Chrome percent-encodes any "@" inside the userinfo, so the one left is the separator.
const USERINFO_PATTERN = "^https?://[^/@]*@";

// An allow rule lets the whole navigation through, whatever else it matches. While userinfo is
// blocked, it must not reach URLs with userinfo, so http://admin@192.168.0.1/ stays blocked as
// a URL with userinfo even though its host is excluded (CONTEXT.md). The ranges are split over
// three rules because together they exceed RE2's memory limit.
function privateIpRules(settings: Settings): chrome.declarativeNetRequest.Rule[] {
  const userinfo = settings.blockUserinfo ? "" : USERINFO;
  return [
    { id: PRIVATE_IPV4_RULE_ID, pattern: PRIVATE_IPV4_PATTERN },
    { id: PRIVATE_IPV6_RULE_ID, pattern: PRIVATE_IPV6_PATTERN },
    { id: PRIVATE_MAPPED_IPV4_RULE_ID, pattern: PRIVATE_MAPPED_IPV4_PATTERN },
  ].map(({ id, pattern }: Readonly<{ id: number; pattern: string }>) => ({
    id,
    priority: ALLOW_PRIORITY,
    condition: {
      regexFilter: `^https?://${userinfo}${pattern}(?::[0-9]+)?/`,
      resourceTypes: RESOURCE_TYPES,
    },
    action: { type: "allow" },
  }));
}

export function buildBlockRules(
  warningPageUrl: string,
  settings: Settings,
): chrome.declarativeNetRequest.Rule[] {
  const hostRules: readonly HostRule[] = [
    IDN_HOST_RULE,
    ...(settings.blockIpHosts ? [IP_HOST_RULE] : []),
  ];
  // While userinfo is blocked, every URL with a password is blocked, so one password rule that
  // matches any host covers them all.
  const passwordRules = settings.blockUserinfo
    ? [passwordRule(USERINFO_PASSWORD_RULE_ID, "", warningPageUrl)]
    : hostRules.map((rule: HostRule) =>
        passwordRule(rule.passwordId, rule.hostPattern, warningPageUrl),
      );
  return [
    ...hostRules.map((rule: HostRule) =>
      redirectRule(rule.id, `^https?://${USERINFO}${rule.hostPattern}`, warningPageUrl),
    ),
    ...(settings.blockUserinfo
      ? [redirectRule(USERINFO_RULE_ID, USERINFO_PATTERN, warningPageUrl)]
      : []),
    ...passwordRules,
    ...(settings.blockIpHosts && settings.excludePrivateIps ? privateIpRules(settings) : []),
  ];
}
