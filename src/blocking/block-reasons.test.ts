import { describe, expect, test } from "vitest";
import { findBlockReasons } from "./block-reasons.ts";
import { DEFAULT_SETTINGS } from "../settings/settings.ts";

function reasons(href: string, settings = DEFAULT_SETTINGS): readonly string[] {
  return findBlockReasons(new URL(href), settings);
}

describe("findBlockReasons with the default settings", () => {
  test.each([
    { url: "https://xn--80a6aa68c8d.com/", expected: ["idnHost"] },
    { url: "https://www.apple.com@example.com/", expected: ["userinfo"] },
    { url: "https://user:secret@example.com/", expected: ["userinfo"] },
    { url: "http://203.0.113.5/", expected: ["ipHost"] },
    { url: "http://[2001:db8::1]/", expected: ["ipHost"] },
    { url: "http://www.apple.com@203.0.113.5/", expected: ["userinfo", "ipHost"] },
    { url: "https://user@xn--80a6aa68c8d.com/", expected: ["idnHost", "userinfo"] },
    { url: "https://xn--a@example.com/", expected: ["userinfo"] },
    { url: "https://example.com/", expected: [] },
    { url: "http://localhost:3000/", expected: [] },
  ] as const)("finds $expected for $url", ({ url, expected }) => {
    expect(reasons(url)).toEqual(expected);
  });
});

describe("findBlockReasons leaves out what the settings turn off", () => {
  test("leaves out userinfo when userinfo blocking is off, but never the IDN host", () => {
    expect(
      reasons("https://user@xn--80a6aa68c8d.com/", { ...DEFAULT_SETTINGS, blockUserinfo: false }),
    ).toEqual(["idnHost"]);
  });

  test("leaves out the IP address host when that is turned off", () => {
    expect(
      reasons("http://www.apple.com@203.0.113.5/", { ...DEFAULT_SETTINGS, blockIpHosts: false }),
    ).toEqual(["userinfo"]);
  });

  test.each([
    { name: "excluded", excludePrivateIps: true, expected: ["userinfo"] },
    { name: "not excluded", excludePrivateIps: false, expected: ["userinfo", "ipHost"] },
  ] as const)(
    "gives http://admin@192.168.0.1/ $expected when private addresses are $name",
    ({ excludePrivateIps, expected }) => {
      expect(
        reasons("http://admin@192.168.0.1/", { ...DEFAULT_SETTINGS, excludePrivateIps }),
      ).toEqual(expected);
    },
  );

  test.each([
    { url: "http://[::]/", expected: [] },
    { url: "http://[::2]/", expected: ["ipHost"] },
  ] as const)("gives $url $expected while private addresses are excluded", ({ url, expected }) => {
    expect(reasons(url, { ...DEFAULT_SETTINGS, excludePrivateIps: true })).toEqual(expected);
  });

  test("keeps a public address while private addresses are excluded", () => {
    expect(
      reasons("http://[::ffff:cb00:7105]/", { ...DEFAULT_SETTINGS, excludePrivateIps: true }),
    ).toEqual(["ipHost"]);
  });
});
