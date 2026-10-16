// Renders assets/icon.svg into the PNG icons that manifest.json lists, using the Chromium
// that Playwright installs for the E2E tests.
// Usage: node scripts/icons.ts
import { readFile } from "node:fs/promises";
import { chromium } from "@playwright/test";

const SOURCE = "assets/icon.svg";
const SIZES = [16, 32, 48, 128] as const;

// Uses the browser launched below; it is only called once the browser exists.
async function render(svg: string, size: number): Promise<void> {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(
    `<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`,
  );
  await page.locator("svg").screenshot({ path: `icons/icon-${size}.png`, omitBackground: true });
  await page.close();
  console.log(`icons/icon-${size}.png`);
}

const svg = await readFile(SOURCE, "utf8");
const browser = await chromium.launch();
try {
  await Promise.all(SIZES.map((size) => render(svg, size)));
} finally {
  await browser.close();
}
