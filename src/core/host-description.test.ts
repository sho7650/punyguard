import { describe, expect, test } from "vitest";
import { describeHost } from "./host-description.ts";

describe("describeHost: Unicode and Punycode forms", () => {
  test("shows the IDN host from the article in Unicode and names the Cyrillic ө", () => {
    const description = describeHost("xn--80a6aa68c8d.com");

    expect(description.unicode).toBe("аррӏө.com");
    expect(description.punycode).toBe("xn--80a6aa68c8d.com");
    expect(description.characters).toContainEqual({
      character: "ө",
      script: "Cyrillic",
      codePoint: "U+04E9",
      isAscii: false,
    });
  });

  test("keeps the Punycode form when the host cannot be decoded", () => {
    const description = describeHost("xn--zz.com");

    expect(description.unicode).toBe("xn--zz.com");
    expect(description.punycode).toBe("xn--zz.com");
    expect(description.characters.every((character) => character.isAscii)).toBe(true);
  });
});

describe("describeHost: characters", () => {
  test("lists every character of a label that mixes Cyrillic and Latin", () => {
    const description = describeHost("xn--pple-43d.com");

    expect(description.unicode).toBe("аpple.com");
    expect(description.characters).toEqual([
      { character: "а", script: "Cyrillic", codePoint: "U+0430", isAscii: false },
      { character: "p", script: "Latin", codePoint: "U+0070", isAscii: true },
      { character: "p", script: "Latin", codePoint: "U+0070", isAscii: true },
      { character: "l", script: "Latin", codePoint: "U+006C", isAscii: true },
      { character: "e", script: "Latin", codePoint: "U+0065", isAscii: true },
      { character: ".", script: "Other", codePoint: "U+002E", isAscii: true },
      { character: "c", script: "Latin", codePoint: "U+0063", isAscii: true },
      { character: "o", script: "Latin", codePoint: "U+006F", isAscii: true },
      { character: "m", script: "Latin", codePoint: "U+006D", isAscii: true },
    ]);
  });

  test("keeps a character outside the BMP whole and writes its five-digit code point", () => {
    const description = describeHost("xn--ls8h.la");

    expect(description.unicode).toBe("💩.la");
    expect(description.characters[0]).toEqual({
      character: "💩",
      script: "Other",
      codePoint: "U+1F4A9",
      isAscii: false,
    });
    expect(description.characters).toHaveLength(4);
  });
});

describe("describeHost: scripts", () => {
  test("names Han and Katakana in Japanese labels", () => {
    const description = describeHost("xn--wgv71a119e.xn--zckzah");

    expect(description.unicode).toBe("日本語.テスト");
    expect(description.characters.map(({ character, script }) => `${character}:${script}`)).toEqual(
      ["日:Han", "本:Han", "語:Han", ".:Other", "テ:Katakana", "ス:Katakana", "ト:Katakana"],
    );
  });

  // Real IDN TLDs: IANA's test TLDs and delegated ones.
  test.each([
    { label: "xn--hxajbheg2az3al", unicode: "παράδειγμα", script: "Greek" },
    { label: "xn--y9a3aq", unicode: "հայ", script: "Armenian" },
    { label: "xn--q9jyb4c", unicode: "みんな", script: "Hiragana" },
    { label: "xn--9t4b11yi5a", unicode: "테스트", script: "Hangul" },
    { label: "xn--kgbechtv", unicode: "إختبار", script: "Arabic" },
    { label: "xn--deba0ad", unicode: "טעסט", script: "Hebrew" },
    { label: "xn--o3cw4h", unicode: "ไทย", script: "Thai" },
    { label: "xn--11b5bs3a9aj6g", unicode: "परीक्षा", script: "Other" },
  ] as const)("names $unicode as $script", ({ label, unicode, script }) => {
    const description = describeHost(label);

    expect(description.unicode).toBe(unicode);
    expect(new Set(description.characters.map((character) => character.script))).toEqual(
      new Set([script]),
    );
  });
});
