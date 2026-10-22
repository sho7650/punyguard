// The two ends a whole-page navigation answered by a seeded Service Worker can reach with
// PunyGuard installed: the warning page, or the attacker page that the settings let through.
import { expect, type Page } from "@playwright/test";
import { maskPassword } from "../../src/blocking/password-mask.ts";
import { ATTACKER_CONTENT, type BlockReason } from "./attacker-site.ts";
import type { Extension } from "./extension.ts";
import type { AttackerVisit, TestServer } from "./server.ts";

// The section of the warning page that names each reason.
const REASON_SECTIONS: Readonly<Record<BlockReason, string>> = {
  idnHost: "#reason-idnHost",
  ipHost: "#reason-ipHost",
  userinfo: "#reason-userinfo",
};

/** Opens the visit as a whole page. The page may move on right away, so waits for the commit. */
export async function openVisit(page: Page, visit: AttackerVisit): Promise<void> {
  await page.goto(visit.url, { waitUntil: "commit" });
}

/** The visit ended on the warning page for the reason, and the attacker page's script never ran. */
export async function expectWarningPage(
  page: Page,
  extension: Extension,
  server: TestServer,
  visit: AttackerVisit,
  reason: BlockReason,
): Promise<void> {
  await expect(page).toHaveURL(`${extension.warningPageUrl}#${maskPassword(visit.url)}`);
  await expect(page.locator(REASON_SECTIONS[reason])).toBeVisible();
  expect(server.beaconsFor(visit)).toEqual([]);
}

/** The visit stayed on the attacker page that the Service Worker built, and its script ran. */
export async function expectAttackerPage(
  page: Page,
  server: TestServer,
  visit: AttackerVisit,
): Promise<void> {
  await expect(page.locator("h1")).toHaveText(ATTACKER_CONTENT);
  await expect
    .poll(() => server.beaconsFor(visit))
    .toEqual([{ visit: visit.id, servedBy: "serviceWorker", controlled: true }]);
}
