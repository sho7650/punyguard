import { describe, expect, test } from "vitest";
import { type BlockReason, findBlockReasons } from "./block-reasons.ts";
import { isIpAddressHost } from "./ip-address.ts";
import type { Settings } from "./settings.ts";
import { decideByRules } from "./test-support/redirect-target.ts";
import { WARNING_PAGE } from "./test-support/warning-page.ts";
import { maskPassword } from "./blocked-url.ts";

// Hosts as a user or a page might write them; new URL() canonicalizes them the way Chrome does
// before it matches the rules (3232235521 becomes 192.168.0.1, [::ffff:192.168.0.1] becomes
// [::ffff:c0a8:1], XN-- becomes xn--, 日本語 becomes xn--).
const hosts = [
  "example.com",
  "login.example.com",
  "example.com.",
  "localhost",
  "axn--b.com",
  "xn--80a6aa68c8d.com",
  "a.xn--80a6aa68c8d.com",
  "example.xn--p1ai",
  "XN--80A6AA68C8D.COM",
  "日本語.jp",
  "xn--p1ai.",
  "203.0.113.5",
  "9.255.255.255",
  "11.0.0.0",
  "100.63.255.255",
  "100.128.0.0",
  "172.15.255.255",
  "172.32.0.0",
  "1.2.3.4.",
  "0.0.0.0",
  "10.0.0.0",
  "10.255.255.255",
  "100.64.0.0",
  "100.127.255.255",
  "127.0.0.1",
  "169.254.0.0",
  "172.16.0.0",
  "172.31.255.255",
  "192.168.0.1",
  "3232235521",
  "0xc0.168.0.1",
  "[2001:db8::1]",
  "[::]",
  "[::1]",
  "[fbff::1]",
  "[fc00::]",
  "[fdff:ffff::1]",
  "[fe80::1]",
  "[FEBF::1]",
  "[fec0::1]",
  "[::ffff:203.0.113.5]",
  "[::ffff:0.0.0.1]",
  "[::ffff:10.0.0.1]",
  "[::ffff:100.64.0.1]",
  "[::ffff:100.128.0.1]",
  "[::ffff:172.16.0.1]",
  "[::ffff:172.32.0.1]",
  "[::ffff:192.168.0.1]",
] as const;

// Every password here contains "secret", so a redirect target that carries it is easy to spot.
const userinfos = [
  "",
  "user@",
  "user:secret@",
  ":secret@",
  "user:@",
  "xn--a@",
  "xn--a:secret@",
  "www.apple.com@",
  "203.0.113.5@",
  "192.168.0.1@",
  "[::1]@",
  "user:pw:secret@",
  "a@b:secret@",
] as const;

const ports = ["", ":8080"] as const;

// The rules look only at the part before the path, so a path full of hosts must change nothing.
const paths = ["/", "/x@203.0.113.5:80/xn--a?next=a@b.xn--c#@10.0.0.1"] as const;

const urls = [
  ...new Set(
    ["http", "https"].flatMap((scheme) =>
      userinfos.flatMap((userinfo) =>
        hosts.flatMap((host) =>
          ports.flatMap((port) =>
            paths.map((path) => new URL(`${scheme}://${userinfo}${host}${port}${path}`).href),
          ),
        ),
      ),
    ),
  ),
];

const allSettings: readonly Settings[] = [true, false].flatMap((blockUserinfo) =>
  [true, false].flatMap((blockIpHosts) =>
    [true, false].map((excludePrivateIps) => ({ blockUserinfo, blockIpHosts, excludePrivateIps })),
  ),
);

const PLAIN_RULE_IDS: Readonly<Record<BlockReason, number>> = {
  idnHost: 1,
  userinfo: 2,
  ipHost: 3,
};
const PASSWORD_RULE_IDS: Readonly<Record<BlockReason, number>> = {
  idnHost: 8,
  userinfo: 7,
  ipHost: 9,
};

// Which allow rule covers a private address, by the form the address takes.
function allowRuleId(hostname: string): number {
  if (hostname.startsWith("[::ffff:")) {
    return 6;
  }
  return hostname.startsWith("[") ? 5 : 4;
}

// The rules that should decide the URL, worked out from the reasons. A URL with no reason is let
// through: by an allow rule when it is an IP host that blocking leaves out (it can only be a
// private one), by no rule otherwise. A blocked URL is redirected by one rule per reason, and a
// URL with a password by the password rules instead, where blocking userinfo alone covers it.
// The IP host rule matches private hosts too and only the allow rule leaves them out, so when
// the allow rule steps aside for userinfo, the IP host rule joins the userinfo rule.
function expectedRuleIds(
  url: Readonly<Pick<URL, "hostname" | "username" | "password">>,
  settings: Settings,
): readonly number[] {
  const reasons = findBlockReasons(url, settings);
  const ipHostRuleMatches = settings.blockIpHosts && isIpAddressHost(url.hostname);
  if (reasons.length === 0) {
    return ipHostRuleMatches ? [allowRuleId(url.hostname)] : [];
  }
  if (url.password !== "") {
    return reasons.includes("userinfo")
      ? [PASSWORD_RULE_IDS.userinfo]
      : reasons.map((reason) => PASSWORD_RULE_IDS[reason]);
  }
  const matched = new Set<BlockReason>([
    ...reasons,
    ...(ipHostRuleMatches ? ["ipHost" as const] : []),
  ]);
  return [...matched].map((reason) => PLAIN_RULE_IDS[reason]);
}

function sorted(ids: readonly number[]): readonly number[] {
  return ids.toSorted((a, b) => a - b);
}

describe("buildBlockRules and findBlockReasons agree on generated URLs", () => {
  test("generates the URLs", () => {
    expect(urls.length).toBeGreaterThan(1000);
  });

  // The warning page explains a block with findBlockReasons, so a URL the rules block must have
  // a reason, a URL with a reason must be blocked, and the rule that blocks it must be the one
  // for that reason. The warning page must get the whole URL, with only the password masked.
  test.each(allSettings)("with %o", (settings) => {
    const disagreements = urls.flatMap((url) => {
      const parsed = new URL(url);
      const { ruleIds, target } = decideByRules(url, settings);
      const reasons = findBlockReasons(parsed, settings);
      const expected = sorted(expectedRuleIds(parsed, settings));
      const expectedTarget = reasons.length > 0 ? `${WARNING_PAGE}#${maskPassword(url)}` : null;
      const agrees =
        target === expectedTarget &&
        sorted(ruleIds).join() === expected.join() &&
        target?.includes("secret") !== true;
      return agrees ? [] : [{ url, ruleIds, expected, reasons, target }];
    });
    expect(disagreements).toEqual([]);
  });
});
