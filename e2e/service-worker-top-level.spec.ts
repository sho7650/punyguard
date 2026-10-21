// Whole-page navigations that the attacker's Service Worker answers, on a profile where it was
// registered before PunyGuard was installed (requirements V-1, V-2, V-2a, V-2b). The first
// navigation has to end on the warning page with the attacker's page never painted and its script
// never run, whether the extension's worker is running or stopped (AC-1 to AC-3), and a password
// in the URL must reach neither the address bar nor any history (FR-8). Chrome refuses one
// combination itself, user info with the relay, and that is checked as Chrome's refusal (below).
import { firstContentfulPaint, openTraced } from "./support/attacker-navigation.ts";
import type { BlockReason } from "./support/attacker-site.ts";
import { historyUrls } from "./support/browser-history.ts";
import type { Extension } from "./support/extension.ts";
import { prepareExtensionWorker, WORKER_STATES } from "./support/extension-worker.ts";
import { startPaintTrace } from "./support/paint-trace.ts";
import { ATTACKER_USERINFO, type AttackerVisit } from "./support/server.ts";
import { expect, test } from "./support/service-worker-fixtures.ts";

const KINDS = ["relay", "synthetic"] as const;

// The warning page's section for each block reason (blocked.html)
const REASON_SECTIONS: Readonly<Record<BlockReason, string>> = {
  idn: "#reason-idnHost",
  ip: "#reason-ipHost",
  userinfo: "#reason-userinfo",
};

const MASKED_USERINFO = "user:***";

// The URL of the page Chrome shows when a navigation fails.
const CHROME_ERROR_PAGE_URL = "chrome-error://chromewebdata/";

// Every reason with every kind and worker state, except user info with the relay, which Chrome
// refuses itself (below).
const COMBINATIONS = (["idn", "ip", "userinfo"] as const).flatMap((reason: BlockReason) =>
  KINDS.filter((kind) => reason !== "userinfo" || kind !== "relay").flatMap((kind) =>
    WORKER_STATES.map((worker) => ({ reason, kind, worker })),
  ),
);

// The warning page for the visit: its URL in the fragment, with the password masked. Only the
// user info visits have one; the others keep their URL as it is.
function warningPageUrl(extension: Extension, visit: AttackerVisit): string {
  return `${extension.warningPageUrl}#${visit.url.replace(`${ATTACKER_USERINFO}@`, `${MASKED_USERINFO}@`)}`;
}

test.describe("a Service Worker's answer to a whole-page navigation goes to the warning page", () => {
  for (const { reason, kind, worker } of COMBINATIONS) {
    test(`${reason}, ${kind}, worker ${worker}: unpainted, no script, first time`, async ({
      extension,
      server,
    }) => {
      const page = await extension.context.newPage();
      await prepareExtensionWorker(extension, page, worker);
      const visit = server.attackerVisit(reason, kind);

      const paints = await openTraced(page, server, visit, "top", async () => {
        await expect(page).toHaveURL(warningPageUrl(extension, visit));
        await expect(page.locator(REASON_SECTIONS[reason])).toBeVisible();
        await firstContentfulPaint(page.mainFrame());
      });

      // A Service Worker answered, so the attacker's document did commit; the content script
      // replaced it before it was painted.
      expect(paints).toMatchObject({ committed: 1, firstPaint: 0, firstContentfulPaint: 0 });
      expect(paints.paint).toBe(0);
      expect(paints.anyDocumentFirstContentfulPaint).toBeGreaterThan(0);
      expect(server.beaconsFor(visit)).toEqual([]);
    });
  }
});

// Chrome refuses to relay a URL with user info: the navigation fails with net::ERR_FAILED and
// ends on Chrome's error page, with nothing committed or painted and no beacon (2026-10-20, 15 of
// 15 runs, with PunyGuard and without it; the controls in service-worker-controls.spec.ts show
// the same without it). PunyGuard never sees a page to move, so the requirements accept Chrome's
// refusal as the outcome. The tab's history keeps an entry with the plaintext password: Chrome
// puts it there itself, and moving the tab with tabs.update after the failure still left it in
// the back history (10 of 10), so the requirements document it as a limit and this does not
// check it.
test.describe("Chrome refuses to relay a Service Worker's answer for a URL with user info", () => {
  for (const worker of WORKER_STATES) {
    test(`worker ${worker}: Chrome's error page, nothing painted, no script`, async ({
      extension,
      server,
    }) => {
      const page = await extension.context.newPage();
      await prepareExtensionWorker(extension, page, worker);
      const visit = server.attackerVisit("userinfo", "relay");

      const trace = await startPaintTrace(page, visit);
      await expect(page.goto(visit.url)).rejects.toThrow("net::ERR_FAILED");
      await expect(page).toHaveURL(CHROME_ERROR_PAGE_URL);
      await firstContentfulPaint(page.mainFrame());
      const paints = await trace.stop();

      // Chrome's error page paints, so the trace was recording.
      expect(paints).toMatchObject({ committed: 0, firstPaint: 0, firstContentfulPaint: 0 });
      expect(paints.paint).toBe(0);
      expect(paints.anyDocumentFirstContentfulPaint).toBeGreaterThan(0);
      expect(server.beaconsFor(visit)).toEqual([]);
    });
  }
});

// The relay is left out: Chrome refuses it before any warning page (above).
test.describe("a password that a Service Worker's answer carries stays masked", () => {
  for (const worker of WORKER_STATES) {
    test(`synthetic, worker ${worker}: in the address bar, the tab's history and the browser history`, async ({
      extension,
      profileDir,
      server,
    }) => {
      const page = await extension.context.newPage();
      await prepareExtensionWorker(extension, page, worker);
      const visit = server.attackerVisit("userinfo", "synthetic");
      const expectedUrl = warningPageUrl(extension, visit);

      await page.goto(visit.url);
      await expect(page).toHaveURL(expectedUrl);
      await expect(page.locator("#userinfo")).toHaveText(MASKED_USERINFO);

      // The new page's about:blank, then the warning page in place of the attacker's entry
      const session = await extension.context.newCDPSession(page);
      const { entries } = await session.send("Page.getNavigationHistory");
      expect(entries.map((entry) => entry.url)).toEqual(["about:blank", expectedUrl]);

      // Chrome records the attacker's URL as well, without its user info (2026-10-20, 2 of 2);
      // the requirements only keep the plaintext password out.
      await extension.context.close();
      const urls = historyUrls(profileDir);
      expect(urls).toContain(expectedUrl);
      expect(urls.filter((url) => url.includes("secret"))).toEqual([]);
    });
  }
});
