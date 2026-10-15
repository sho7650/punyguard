import { toUnicode, ucs2 } from "punycode/";

export interface HostCharacter {
  readonly character: string;
  readonly script: string;
  readonly codePoint: string;
  readonly isAscii: boolean;
}

export interface HostDescription {
  readonly unicode: string;
  readonly punycode: string;
  readonly characters: readonly HostCharacter[];
}

const SCRIPTS = [
  "Latin",
  "Cyrillic",
  "Greek",
  "Armenian",
  "Han",
  "Hiragana",
  "Katakana",
  "Hangul",
  "Arabic",
  "Hebrew",
  "Thai",
].map((name) => ({ name, pattern: new RegExp(String.raw`\p{Script=${name}}`, "u") }));

function scriptOf(character: string): string {
  for (const { name, pattern } of SCRIPTS) {
    if (pattern.test(character)) {
      return name;
    }
  }
  return "Other";
}

function describeCharacter(codePoint: number): HostCharacter {
  const character = String.fromCodePoint(codePoint);
  return {
    character,
    script: scriptOf(character),
    codePoint: `U+${codePoint.toString(16).toUpperCase().padStart(4, "0")}`,
    isAscii: codePoint < 0x80,
  };
}

// The host comes from an untrusted fragment, so it may not be valid Punycode.
function decodeHost(asciiHost: string): string {
  try {
    return toUnicode(asciiHost);
  } catch {
    return asciiHost;
  }
}

export function describeHost(asciiHost: string): HostDescription {
  const unicode = decodeHost(asciiHost);
  return {
    unicode,
    punycode: asciiHost,
    characters: ucs2.decode(unicode).map((codePoint) => describeCharacter(codePoint)),
  };
}
