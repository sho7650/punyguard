// The attacker's Service Worker answers a blocked navigation with a redirect, which the block
// rules never see (requirements FR-9, AC-4, V-2d). The frame must end on the warning page for
// the original URL, with the password masked (FR-8) and nothing else left in the tab's history.
// The redirected page may paint and run its script before it is replaced (AC-4), so this file
// records the attacker window but does not judge it.
import type { Page } from "@playwright/test";
import {
  firstContentfulPaint,
  openTraced,
  openTracedInIframe,
  PLACEMENTS,
  placementFrame,
  type Placement,
} from "./support/attacker-navigation.ts";
import { type BlockReason, scopePath } from "./support/attacker-site.ts";
import type { Extension } from "./support/extension.ts";
import {
  prepareExtensionWorker,
  WORKER_STATES,
  type WorkerState,
} from "./support/extension-worker.ts";
import type { AttackerPaints } from "./support/paint-trace.ts";
import { expect, test } from "./support/service-worker-fixtures.ts";
import { ATTACKER_USERINFO, type AttackerVisit, type TestServer } from "./support/server.ts";

type RedirectKind = "redirectSameOrigin" | "redirectPlainHost";

const REASON_SECTIONS: Readonly<Record<BlockReason, string>> = {
  idn: "#reason-idnHost",
  ip: "#reason-ipHost",
  userinfo: "#reason-userinfo",
};

// Chrome refuses a URL with user info in an iframe before any request, so no Service Worker is
// asked (embedded-documents.spec.ts; service-worker-profile.ts registers none there).
const COMBINATIONS = (["idn", "ip", "userinfo"] as const).flatMap((reason: BlockReason) =>
  (["redirectSameOrigin", "redirectPlainHost"] as const).flatMap((kind: RedirectKind) =>
    PLACEMENTS.filter(
      (placement: Placement) => reason !== "userinfo" || placement === "top",
    ).flatMap((placement) =>
      WORKER_STATES.map((worker) => ({
        reason,
        kind,
        placement,
        worker,
      })),
    ),
  ),
);

// redirectSameOrigin lands on its scope's landing page (attacker-site.ts) on the origin without
// user info. For an IDN or IP address host the landing is blocked as well, so the content script
// moves it with its own URL, while the webNavigation fallback in background.ts would use the URL
// the navigation started at: the landing URL in the warning page shows the content script moved
// it. Any other landing is not blocked, and the fallback moves it with the start, its password
// masked.
function expectedWarningUrl(
  extension: Extension,
  visit: AttackerVisit,
  reason: BlockReason,
  kind: RedirectKind,
): string {
  if (kind === "redirectSameOrigin" && reason !== "userinfo") {
    const landing = new URL(visit.url);
    landing.pathname = `${scopePath(kind)}landing`;
    return `${extension.warningPageUrl}#${landing.href}`;
  }
  const masked = visit.url.replace(`${ATTACKER_USERINFO}@`, "user:***@");
  return `${extension.warningPageUrl}#${masked}`;
}

interface Navigation {
  readonly extension: Extension;
  readonly server: TestServer;
  readonly visit: AttackerVisit;
  readonly placement: Placement;
  readonly worker: WorkerState;
}

// Opens the visit with the extension's worker in the state when the visit's frame navigates. An
// iframe's embedding page starts the worker again (extension-worker.ts), so for an iframe the
// worker is put in the state after that page has loaded.
async function openWithWorker(
  page: Page,
  { extension, server, visit, placement, worker }: Navigation,
  settled: () => Promise<void>,
): Promise<AttackerPaints> {
  if (placement === "iframe") {
    const beforeNavigation = (): Promise<void> => prepareExtensionWorker(extension, page, worker);
    return openTracedInIframe(page, server, visit, beforeNavigation, settled);
  }
  await prepareExtensionWorker(extension, page, worker);
  return openTraced(page, server, visit, placement, settled);
}

async function navigationHistory(page: Page): Promise<readonly string[]> {
  const session = await page.context().newCDPSession(page);
  const { entries } = await session.send("Page.getNavigationHistory");
  await session.detach();
  return entries.map((entry) => entry.url);
}

test.describe("a Service Worker's redirect ends on the warning page", () => {
  for (const { reason, kind, placement, worker } of COMBINATIONS) {
    test(`${reason}, ${kind}, ${placement}, extension worker ${worker}`, async ({
      extension,
      server,
    }) => {
      const page = await extension.context.newPage();
      const visit = server.attackerVisit(reason, kind);
      const warningUrl = expectedWarningUrl(extension, visit, reason, kind);
      const navigation = { extension, server, visit, placement, worker };

      const paints = await openWithWorker(page, navigation, async () => {
        const frame = await placementFrame(page, placement);
        await expect.poll(() => frame.url()).toBe(warningUrl);
        await expect(frame.locator(REASON_SECTIONS[reason])).toBeVisible();
        await firstContentfulPaint(frame);
      });
      test.info().annotations.push({
        type: "attacker window",
        description: JSON.stringify({ ...paints, beacons: server.beaconsFor(visit).length }),
      });

      // The new page's about:blank stays as the first entry. After it, a top-level redirect
      // leaves only the warning page (Phase 0, tasks/todo-service-worker-bypass.md: one entry in
      // every condition), and an iframe's navigations leave only the embedding page, which must
      // still be the ASCII page and not the warning page. The iframe leaves its initial
      // about:blank, so pointing it at the visit replaces that entry instead of adding one.
      if (placement === "iframe") {
        expect(new URL(page.url()).origin).toBe(new URL(server.asciiUrl("/")).origin);
      }
      const lastEntry = placement === "top" ? warningUrl : page.url();
      expect(await navigationHistory(page)).toEqual(["about:blank", lastEntry]);
    });
  }
});
