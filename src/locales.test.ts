/// <reference types="node" />
// chrome.i18n.getMessage returns "" for a missing key, so a lost message would show up only
// as blank text on the page or a blank tooltip line. These tests check that every key the
// code uses has a message in both catalogs.
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import en from "../_locales/en/messages.json" with { type: "json" };
import ja from "../_locales/ja/messages.json" with { type: "json" };
import { SCRIPT_NAMES } from "./core/host-description.ts";
import { PROTECTION_MESSAGE_KEYS } from "./core/protection.ts";

const catalogs: Readonly<Record<string, Readonly<Record<string, { readonly message: string }>>>> = {
  ja,
  en,
};

// Keys the warning page fills in through data-i18n attributes
const blockedPageKeys =
  readFileSync(new URL("blocked.html", import.meta.url), "utf8").match(/(?<=data-i18n=")[^"]+/gu) ??
  [];

const usedKeys = [
  ...PROTECTION_MESSAGE_KEYS,
  ...blockedPageKeys,
  ...SCRIPT_NAMES.map((name) => `script${name}`),
];

test("the Japanese and English messages define the same keys", () => {
  expect(Object.keys(ja).toSorted()).toEqual(Object.keys(en).toSorted());
});

test("the warning page uses data-i18n keys", () => {
  expect(blockedPageKeys).toContain("heading");
});

describe.each(Object.entries(catalogs))("the %s catalog", (_language, catalog) => {
  test.each(usedKeys)("has a message for %s", (key) => {
    expect(catalog[key]?.message ?? "").not.toBe("");
  });
});
