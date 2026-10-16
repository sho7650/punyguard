// Japanese for a Japanese UI, English for anything else. Linux Chromium takes its UI language
// from LANGUAGE; macOS Chromium takes it from the OS bundle settings and ignores the variable,
// so these run on Linux (CI) only and macOS is checked by hand (tasks/todo.md, Phase 6).
import { expect, test } from "./support/fixtures.ts";

test.skip(process.platform !== "linux", "Chromium reads LANGUAGE on Linux only");

const cases = [
  { uiLanguage: "ja", lang: "ja", heading: "PunyGuard がこのページへの移動を止めました" },
  { uiLanguage: "en", lang: "en", heading: "PunyGuard blocked this page" },
  // No French catalog: English text, and <html lang> must say so (not "fr").
  { uiLanguage: "fr", lang: "en", heading: "PunyGuard blocked this page" },
] as const;

for (const { uiLanguage, lang, heading } of cases) {
  test.describe(`with LANGUAGE=${uiLanguage}`, () => {
    test.use({ uiLanguage });

    test(`shows the ${lang} text`, async ({ extension, server }) => {
      const page = await extension.context.newPage();
      await page.goto(server.idnUrl("/"));

      await expect(page.locator("html")).toHaveAttribute("lang", lang);
      await expect(page.locator("h1")).toHaveText(heading);
    });
  });
}
