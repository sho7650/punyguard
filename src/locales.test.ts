import { expect, test } from "vitest";
import en from "../_locales/en/messages.json" with { type: "json" };
import ja from "../_locales/ja/messages.json" with { type: "json" };

test("the Japanese and English messages define the same keys", () => {
  expect(Object.keys(ja).toSorted()).toEqual(Object.keys(en).toSorted());
});
