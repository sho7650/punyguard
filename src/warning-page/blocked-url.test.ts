import { describe, expect, test } from "vitest";
import { parseBlockedUrl } from "./blocked-url.ts";
import { WARNING_PAGE } from "../test-support/warning-page.ts";

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
    { name: "a chrome-extension: URL", hash: `#${WARNING_PAGE}` },
  ] as const)("returns null for $name", ({ hash }) => {
    expect(parseBlockedUrl(hash)).toBeNull();
  });
});
