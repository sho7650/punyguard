import { describe, expect, test } from "vitest";
import { buildBlockRule } from "./block-rule.ts";

const WARNING_PAGE = "chrome-extension://abcdefghijklmnop/blocked.html";

const rule = buildBlockRule(WARNING_PAGE);

// Where Chrome sends a request that the block rule matches, or null when the rule does not match.
// Chrome replaces only the matched part of the URL with regexSubstitution, where \0 is the
// whole match, and keeps the rest of the URL after it.
function redirectTarget(url: string): string | null {
  const { regexFilter, isUrlFilterCaseSensitive } = rule.condition;
  const substitution = rule.action.redirect?.regexSubstitution;
  if (regexFilter === undefined || substitution === undefined) {
    throw new Error("Expected a regexFilter rule that redirects with regexSubstitution");
  }
  const pattern = new RegExp(regexFilter, isUrlFilterCaseSensitive === true ? "" : "i");
  if (!pattern.test(url)) {
    return null;
  }
  return url.replace(pattern, (match) => substitution.replaceAll(String.raw`\0`, match));
}

describe("buildBlockRule: IDN hosts", () => {
  test("redirects a URL whose IDN host starts with xn-- to the warning page with the original URL", () => {
    expect(redirectTarget("https://xn--80a6aa68c8d.com/login?next=/")).toBe(
      "chrome-extension://abcdefghijklmnop/blocked.html#https://xn--80a6aa68c8d.com/login?next=/",
    );
  });

  test("blocks an IDN label that is not the first label of the host", () => {
    expect(redirectTarget("http://login.xn--80a6aa68c8d.com/")).toBe(
      "chrome-extension://abcdefghijklmnop/blocked.html#http://login.xn--80a6aa68c8d.com/",
    );
  });

  test("blocks an IDN host that follows userinfo", () => {
    expect(redirectTarget("https://user@xn--80a6aa68c8d.com/")).toBe(
      "chrome-extension://abcdefghijklmnop/blocked.html#https://user@xn--80a6aa68c8d.com/",
    );
  });

  test.each([
    { name: "only the TLD is IDN", url: "https://example.xn--q9jyb4c/" },
    { name: "the IDN host has a port", url: "https://xn--80a6aa68c8d.com:8443/" },
  ] as const)("blocks a URL where $name", ({ url }) => {
    expect(redirectTarget(url)).toBe(`${WARNING_PAGE}#${url}`);
  });
});

describe("buildBlockRule: ASCII hosts", () => {
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
    { name: "an IP address", url: "http://192.168.0.1:8080/" },
    { name: "localhost", url: "http://localhost:3000/" },
  ] as const)("does not block $name", ({ url }) => {
    expect(redirectTarget(url)).toBeNull();
  });

  // Known false positive, accepted for v1 (tasks/todo.md "将来"): xn-- in the userinfo
  // matches even though the host is ASCII. Flip this test when the false positive is fixed.
  test("blocks xn-- in the userinfo even though the host is ASCII", () => {
    expect(redirectTarget("https://xn--a@example.com/")).toBe(
      "chrome-extension://abcdefghijklmnop/blocked.html#https://xn--a@example.com/",
    );
  });
});

describe("buildBlockRule: resource types", () => {
  test("applies only to page navigations and iframes, not to subresources", () => {
    expect(new Set(rule.condition.resourceTypes)).toEqual(new Set(["main_frame", "sub_frame"]));
  });
});
