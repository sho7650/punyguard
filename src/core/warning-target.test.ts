import { describe, expect, test } from "vitest";
import { DEFAULT_SETTINGS } from "./settings.ts";
import { warningTarget } from "./warning-target.ts";
import { WARNING_PAGE } from "./test-support/warning-page.ts";

describe("warningTarget", () => {
  test("sends a page on an IDN host to the warning page with its URL in the fragment", () => {
    expect(
      warningTarget("https://xn--80a6aa68c8d.com/login?next=/", DEFAULT_SETTINGS, WARNING_PAGE),
    ).toBe(`${WARNING_PAGE}#https://xn--80a6aa68c8d.com/login?next=/`);
  });

  test("masks the password and keeps the user name, like the block rules", () => {
    expect(
      warningTarget("https://paypal.com:secret@example.com/", DEFAULT_SETTINGS, WARNING_PAGE),
    ).toBe(`${WARNING_PAGE}#https://paypal.com:***@example.com/`);
  });

  // The block rules only match http and https, so neither do these.
  test.each([
    { url: "file://203.0.113.5/share/file.html" },
    { url: "file://xn--80a6aa68c8d.com/share/file.html" },
  ] as const)("leaves $url where it is", ({ url }) => {
    expect(warningTarget(url, DEFAULT_SETTINGS, WARNING_PAGE)).toBeNull();
  });
});

describe("warningTarget follows the settings", () => {
  test.each([
    {
      name: "a page that meets no reason",
      url: "https://example.com/",
      settings: DEFAULT_SETTINGS,
    },
    {
      name: "a URL with user info while that blocking is off",
      url: "https://paypal.com@example.com/",
      settings: { ...DEFAULT_SETTINGS, blockUserinfo: false },
    },
    {
      name: "an IP address host while that blocking is off",
      url: "http://203.0.113.5/",
      settings: { ...DEFAULT_SETTINGS, blockIpHosts: false },
    },
    {
      name: "a private IP address while those are excluded",
      url: "http://192.168.0.1/",
      settings: { ...DEFAULT_SETTINGS, excludePrivateIps: true },
    },
  ] as const)("leaves $name where it is", ({ url, settings }) => {
    expect(warningTarget(url, settings, WARNING_PAGE)).toBeNull();
  });

  test("still sends an IDN host to the warning page with everything else turned off", () => {
    expect(
      warningTarget(
        "https://user@xn--80a6aa68c8d.com/",
        { blockUserinfo: false, blockIpHosts: false, excludePrivateIps: true },
        WARNING_PAGE,
      ),
    ).toBe(`${WARNING_PAGE}#https://user@xn--80a6aa68c8d.com/`);
  });
});
