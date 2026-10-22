/// <reference types="node" />
// chrome.i18n.getMessage returns "" for a missing key, so a lost message would show up only
// as blank text on the page or a blank tooltip line. These tests check that every key the
// code uses has a message in both catalogs.
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import en from "../../_locales/en/messages.json" with { type: "json" };
import ja from "../../_locales/ja/messages.json" with { type: "json" };
import { SCRIPT_NAMES } from "../warning-page/host-description.ts";
import { PROTECTION_MESSAGE_KEYS } from "../protection.ts";

const catalogs: Readonly<Record<string, Readonly<Record<string, { readonly message: string }>>>> = {
  ja,
  en,
};

// Keys a page fills in through data-i18n attributes
function pageKeys(page: string): string[] {
  return (
    readFileSync(new URL(page, import.meta.url), "utf8").match(/(?<=data-i18n=")[^"]+/gu) ?? []
  );
}

const warningPageKeys = pageKeys("../warning-page/warning-page.html");
const optionsPageKeys = pageKeys("../settings/options.html");

const usedKeys = [
  ...PROTECTION_MESSAGE_KEYS,
  ...warningPageKeys,
  ...optionsPageKeys,
  ...SCRIPT_NAMES.map((name) => `script${name}`),
];

test("the Japanese and English messages define the same keys", () => {
  expect(Object.keys(ja).toSorted()).toEqual(Object.keys(en).toSorted());
});

test("the warning page and the options page use data-i18n keys", () => {
  expect(warningPageKeys).toContain("headingUserinfo");
  expect(optionsPageKeys).toContain("optionBlockIpHosts");
});

describe.each(Object.entries(catalogs))("the %s catalog", (_language, catalog) => {
  test.each(usedKeys)("has a message for %s", (key) => {
    expect(catalog[key]?.message ?? "").not.toBe("");
  });
});
