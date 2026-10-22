import { describe, expect, test } from "vitest";
import { maskPassword } from "./password-mask.ts";

describe("maskPassword", () => {
  test("masks the password and keeps the user name, which can hold the xn-- that was blocked", () => {
    expect(maskPassword("https://xn--a:secret@xn--80a6aa68c8d.com/login")).toBe(
      "https://xn--a:***@xn--80a6aa68c8d.com/login",
    );
  });

  // Dropping it would leave no userinfo at all, and nothing to explain the block with.
  test("keeps a password alone as a masked password", () => {
    expect(maskPassword("https://:secret@example.com/")).toBe("https://:***@example.com/");
  });

  test("leaves a URL without a password as it is", () => {
    expect(maskPassword("https://xn--80a6aa68c8d.com/a?b#c")).toBe(
      "https://xn--80a6aa68c8d.com/a?b#c",
    );
  });
});
