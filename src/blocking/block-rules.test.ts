import { describe, expect, test } from "vitest";
import { buildBlockRules } from "./block-rules.ts";
import { DEFAULT_SETTINGS } from "../settings/settings.ts";
import { redirectTarget } from "../test-support/redirect-target.ts";
import { WARNING_PAGE } from "../test-support/warning-page.ts";

// Hosts as Chrome canonicalizes them, at both ends of each range. An IPv4-mapped IPv6 host
// carries the IPv4 address in its last two groups: [::ffff:c0a8:1] is 192.168.0.1.
const privateHosts = [
  "0.0.0.0",
  "0.255.255.255",
  "10.0.0.0",
  "10.255.255.255",
  "100.64.0.0",
  "100.127.255.255",
  "127.0.0.1",
  "169.254.0.0",
  "169.254.255.255",
  "172.16.0.0",
  "172.31.255.255",
  "192.168.0.0",
  "192.168.255.255",
  "[::]",
  "[::1]",
  "[fc00::]",
  "[fdff:ffff::1]",
  "[fe80::1]",
  "[febf:ffff::1]",
  "[::ffff:0:1]",
  "[::ffff:a00:1]",
  "[::ffff:6440:1]",
  "[::ffff:647f:ffff]",
  "[::ffff:7f00:1]",
  "[::ffff:a9fe:1]",
  "[::ffff:ac10:0]",
  "[::ffff:ac1f:ffff]",
  "[::ffff:c0a8:1]",
] as const;

const publicHosts = [
  "1.0.0.0",
  "9.255.255.255",
  "11.0.0.0",
  "100.63.255.255",
  "100.128.0.0",
  "126.255.255.255",
  "128.0.0.0",
  "169.253.255.255",
  "169.255.0.0",
  "172.15.255.255",
  "172.32.0.0",
  "192.167.255.255",
  "192.169.0.0",
  "203.0.113.5",
  "[::2]",
  "[2001:db8::1]",
  "[fbff::1]",
  "[fe00::1]",
  "[fec0::1]",
  "[::ffff:100:1]",
  "[::ffff:643f:ffff]",
  "[::ffff:6480:0]",
  "[::ffff:ac0f:ffff]",
  "[::ffff:ac20:0]",
  "[::ffff:c0a9:1]",
  "[::ffff:cb00:7105]",
] as const;

describe("buildBlockRules: IDN hosts", () => {
  test("redirects a URL whose IDN host starts with xn-- to the warning page with the original URL", () => {
    expect(redirectTarget("https://xn--80a6aa68c8d.com/login?next=/")).toBe(
      `${WARNING_PAGE}#https://xn--80a6aa68c8d.com/login?next=/`,
    );
  });

  test("blocks an IDN label that is not the first label of the host", () => {
    expect(redirectTarget("http://login.xn--80a6aa68c8d.com/")).toBe(
      `${WARNING_PAGE}#http://login.xn--80a6aa68c8d.com/`,
    );
  });

  test("blocks an IDN host that follows userinfo, even with userinfo blocking off", () => {
    expect(
      redirectTarget("https://user@xn--80a6aa68c8d.com/", {
        ...DEFAULT_SETTINGS,
        blockUserinfo: false,
      }),
    ).toBe(`${WARNING_PAGE}#https://user@xn--80a6aa68c8d.com/`);
  });

  test.each([
    { name: "only the TLD is IDN", url: "https://example.xn--q9jyb4c/" },
    { name: "the IDN host has a port", url: "https://xn--80a6aa68c8d.com:8443/" },
  ] as const)("blocks a URL where $name", ({ url }) => {
    expect(redirectTarget(url)).toBe(`${WARNING_PAGE}#${url}`);
  });
});

describe("buildBlockRules: userinfo", () => {
  test("redirects a URL with userinfo to the warning page with the original URL", () => {
    expect(redirectTarget("https://www.apple.com@example.com/login")).toBe(
      `${WARNING_PAGE}#https://www.apple.com@example.com/login`,
    );
  });
});

describe("buildBlockRules: passwords", () => {
  const userinfoOff = { ...DEFAULT_SETTINGS, blockUserinfo: false };

  // The redirect target lands in the warning page's address bar and in the browser history,
  // so the password is masked before it gets there.
  test.each([
    { name: "a user name and password", url: "https://user:secret@example.com/login" },
    { name: "a password alone", url: "https://:secret@example.com/" },
    { name: "a password on an IDN host", url: "https://user:secret@xn--80a6aa68c8d.com/" },
    { name: "a password on an IP address host", url: "http://user:secret@203.0.113.5:8080/" },
  ] as const)("masks $name in the URL sent to the warning page", ({ url }) => {
    expect(redirectTarget(url)).toBe(`${WARNING_PAGE}#${url.replace(":secret@", ":***@")}`);
  });

  test.each([
    { name: "an IDN host", url: "https://user:secret@a.xn--80a6aa68c8d.com:8443/a?b#c" },
    { name: "an IPv4 host", url: "http://user:secret@203.0.113.5:8080/" },
    { name: "an IPv6 host", url: "http://:secret@[2001:db8::1]/" },
  ] as const)("masks a password on $name with userinfo blocking off", ({ url }) => {
    expect(redirectTarget(url, userinfoOff)).toBe(
      `${WARNING_PAGE}#${url.replace(":secret@", ":***@")}`,
    );
  });

  test("still masks a password on a private address while userinfo blocking is on", () => {
    expect(
      redirectTarget("http://admin:secret@192.168.0.1/", {
        ...DEFAULT_SETTINGS,
        excludePrivateIps: true,
      }),
    ).toBe(`${WARNING_PAGE}#http://admin:***@192.168.0.1/`);
  });

  test("lets a password on an ASCII host through while userinfo blocking is off", () => {
    expect(redirectTarget("https://user:secret@example.com/", userinfoOff)).toBeNull();
  });

  test("does not mask a password on an IP address host while that blocking is off", () => {
    expect(
      redirectTarget("http://user:secret@203.0.113.5/", { ...userinfoOff, blockIpHosts: false }),
    ).toBeNull();
  });
});

describe("buildBlockRules: IP address hosts", () => {
  test.each([
    { name: "an IPv4 host", url: "http://203.0.113.5/login" },
    { name: "an IPv4 host with a port", url: "http://203.0.113.5:8080/" },
    { name: "an IPv6 host", url: "http://[2001:db8::1]/" },
    { name: "an IPv4-mapped IPv6 host with a port", url: "https://[::ffff:cb00:7105]:8443/" },
  ] as const)("redirects $name to the warning page with the original URL", ({ url }) => {
    expect(redirectTarget(url)).toBe(`${WARNING_PAGE}#${url}`);
  });

  const userinfoOff = { ...DEFAULT_SETTINGS, blockUserinfo: false };

  test("blocks an IP address host that follows userinfo, even with userinfo blocking off", () => {
    expect(redirectTarget("http://user@203.0.113.5:8080/", userinfoOff)).toBe(
      `${WARNING_PAGE}#http://user@203.0.113.5:8080/`,
    );
  });

  test("does not treat an address in the userinfo as the host", () => {
    expect(redirectTarget("http://203.0.113.5@example.com/", userinfoOff)).toBeNull();
  });

  test("does not block IP address hosts when that is turned off", () => {
    expect(
      redirectTarget("http://203.0.113.5/", { ...DEFAULT_SETTINGS, blockIpHosts: false }),
    ).toBeNull();
  });
});

describe("buildBlockRules: private IP addresses", () => {
  const excludePrivate = { ...DEFAULT_SETTINGS, excludePrivateIps: true };

  test.each(privateHosts)("blocks %s by default", (host) => {
    const url = `http://${host}/`;
    expect(redirectTarget(url)).toBe(`${WARNING_PAGE}#${url}`);
  });

  test.each(privateHosts)("lets %s through when private addresses are excluded", (host) => {
    expect(redirectTarget(`http://${host}:8080/admin`, excludePrivate)).toBeNull();
  });

  test.each(publicHosts)("still blocks %s when private addresses are excluded", (host) => {
    const url = `http://${host}:8080/admin`;
    expect(redirectTarget(url, excludePrivate)).toBe(`${WARNING_PAGE}#${url}`);
  });

  test("still blocks a private address with userinfo while userinfo blocking is on", () => {
    expect(redirectTarget("http://admin@192.168.0.1/", excludePrivate)).toBe(
      `${WARNING_PAGE}#http://admin@192.168.0.1/`,
    );
  });

  test("lets a private address with userinfo through while userinfo blocking is off", () => {
    expect(
      redirectTarget("http://admin@192.168.0.1/", { ...excludePrivate, blockUserinfo: false }),
    ).toBeNull();
  });
});

describe("buildBlockRules: ASCII hosts", () => {
  test.each([
    { name: "an ASCII host", url: "https://apple.com/" },
    {
      name: "an ASCII host with a non-ASCII path",
      url: "https://ja.wikipedia.org/wiki/%E6%9D%B1%E4%BA%AC",
    },
    { name: "xn-- only in the path", url: "https://example.com/xn--80a6aa68c8d" },
    { name: "xn-- only in the query", url: "https://example.com/?host=a.xn--80a6aa68c8d.com" },
    { name: "xn-- only in the fragment", url: "https://example.com/#a.xn--80a6aa68c8d.com" },
    { name: "xn-- in the middle of a label", url: "https://axn--b.com/" },
    { name: "localhost", url: "http://localhost:3000/" },
  ] as const)("does not block $name", ({ url }) => {
    expect(redirectTarget(url)).toBeNull();
  });

  test("does not treat xn-- in the userinfo as an IDN host", () => {
    expect(
      redirectTarget("https://xn--a@example.com/", { ...DEFAULT_SETTINGS, blockUserinfo: false }),
    ).toBeNull();
  });
});

describe("buildBlockRules: resource types", () => {
  // Between them, these settings produce every rule buildBlockRules can make.
  test.each([
    DEFAULT_SETTINGS,
    { blockUserinfo: false, blockIpHosts: true, excludePrivateIps: true },
  ])("applies only to page navigations and embedded documents, with %o", (settings) => {
    for (const rule of buildBlockRules(WARNING_PAGE, settings)) {
      expect(new Set(rule.condition.resourceTypes)).toEqual(
        new Set(["main_frame", "sub_frame", "object"]),
      );
    }
  });
});
