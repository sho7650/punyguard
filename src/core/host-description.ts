import { toUnicode } from "punycode/";

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

const DETECTED_SCRIPTS = [
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
] as const;
const OTHER_SCRIPT = "Other";

// Every script name describeHost can report; the warning page shows each as script<Name>.
export const SCRIPT_NAMES: readonly string[] = [...DETECTED_SCRIPTS, OTHER_SCRIPT];

const SCRIPTS = DETECTED_SCRIPTS.map((name) => ({
  name,
  pattern: new RegExp(String.raw`\p{Script=${name}}`, "u"),
}));

function scriptOf(character: string): string {
  for (const { name, pattern } of SCRIPTS) {
    if (pattern.test(character)) {
      return name;
    }
  }
  return OTHER_SCRIPT;
}

function describeCharacter(character: string): HostCharacter {
  // Array.from never yields an empty string; the fallback only satisfies the type.
  const codePoint = character.codePointAt(0) ?? 0;
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
    // Array.from splits by code point, so characters outside the BMP stay whole.
    characters: Array.from(unicode, (character) => describeCharacter(character)),
  };
}
