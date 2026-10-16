import { describe, expect, test } from "vitest";
import { hidePassword, parseBlockedUrl } from "./blocked-url.ts";

describe("parseBlockedUrl", () => {
  test("reads the original URL from the warning page's fragment", () => {
    expect(parseBlockedUrl("#https://xn--80a6aa68c8d.com/login?next=/")?.href).toBe(
      "https://xn--80a6aa68c8d.com/login?next=/",
    );
  });

  test("keeps the original URL's own fragment", () => {
    expect(parseBlockedUrl("#https://xn--80a6aa68c8d.com/page#section")?.href).toBe(
      "https://xn--80a6aa68c8d.com/page#section",
    );
  });

  test.each([
    { name: "an empty hash", hash: "" },
    { name: "a bare #", hash: "#" },
    { name: "text that is not a URL", hash: "#not a url" },
    { name: "a javascript: URL", hash: "#javascript:alert(1)" },
    { name: "a data: URL", hash: "#data:text/html,<script>alert(1)</script>" },
    { name: "a file: URL", hash: "#file:///etc/passwd" },
    { name: "a chrome-extension: URL", hash: "#chrome-extension://abcdefghijklmnop/blocked.html" },
  ] as const)("returns null for $name", ({ hash }) => {
    expect(parseBlockedUrl(hash)).toBeNull();
  });
});

describe("hidePassword", () => {
  test("drops the password and keeps the user name, which can hold the xn-- that was blocked", () => {
    expect(hidePassword("https://xn--a:secret@xn--80a6aa68c8d.com/login")).toBe(
      "https://xn--a@xn--80a6aa68c8d.com/login",
    );
  });

  test("leaves a URL without a password as it is", () => {
    expect(hidePassword("https://xn--80a6aa68c8d.com/a?b#c")).toBe(
      "https://xn--80a6aa68c8d.com/a?b#c",
    );
  });
});
