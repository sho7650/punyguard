// Navigations inside an iframe that the attacker's Service Worker answers, which the block rules
// never see (requirements FR-1 to FR-3, AC-1, AC-2, V-2). The Service Workers were registered
// from an iframe on ASCII_HOST before PunyGuard was installed (service-worker-profile.ts), and
// service-worker-controls.spec.ts shows that without PunyGuard they answer these frames, which
// then send their beacon and are painted.
import {
  firstContentfulPaint,
  openTraced,
  openTracedInIframe,
  placementFrame,
} from "./support/attacker-navigation.ts";
import { ATTACKER_CONTENT } from "./support/attacker-site.ts";
import { prepareExtensionWorker, WORKER_STATES } from "./support/extension-worker.ts";
import { expect, test } from "./support/service-worker-fixtures.ts";

// The warning page's section for each reason a Service Worker can answer in an iframe.
const REASON_SECTIONS = { idn: "#reason-idnHost", ip: "#reason-ipHost" } as const;

const COMBINATIONS = (["idn", "ip"] as const).flatMap((reason) =>
  (["relay", "synthetic"] as const).flatMap((kind) =>
    WORKER_STATES.map((state) => ({ reason, kind, state })),
  ),
);

test.describe("an iframe that a Service Worker answers shows the warning page inside it", () => {
  for (const { reason, kind, state } of COMBINATIONS) {
    test(`${reason}, ${kind}, extension worker ${state}`, async ({ extension, server }) => {
      const page = await extension.context.newPage();
      const visit = server.attackerVisit(reason, kind);

      // The worker is stopped after the embedding page has loaded, so the iframe's navigation is
      // the one that meets it stopped.
      const paints = await openTracedInIframe(
        page,
        server,
        visit,
        () => prepareExtensionWorker(extension, page, state),
        async () => {
          const frame = await placementFrame(page, "iframe");
          await expect(frame.locator(REASON_SECTIONS[reason])).toBeVisible();
          await firstContentfulPaint(frame);
        },
      );

      const frame = await placementFrame(page, "iframe");
      expect(frame.url()).toBe(`${extension.warningPageUrl}#${visit.url}`);
      await expect(frame.locator("#original-url")).toHaveText(visit.url);
      // In an iframe the buttons would act on the embedding page's tab (blocked.ts).
      await expect(frame.locator("#details")).toBeVisible();
      await expect(frame.locator("#actions")).toBeHidden();
      await expect(page.locator("#outer")).toBeVisible();
      // The attacker document commits, and the content script replaces it before its first
      // paint; the warning page paints, so the trace was recording.
      expect(paints).toMatchObject({ committed: 1, firstPaint: 0, firstContentfulPaint: 0 });
      expect(paints.paint).toBe(0);
      expect(paints.anyDocumentFirstContentfulPaint).toBeGreaterThan(0);
      expect(server.beaconsFor(visit)).toEqual([]);
    });
  }
});

// Chrome refuses an iframe whose URL has user info in the renderer, before any request, so no
// Service Worker is asked and PunyGuard plays no part: the Service Worker's kind and the
// extension's worker do not matter. Measured 2026-10-20 without PunyGuard, with Service Workers
// of both kinds registered from an iframe on ASCII_HOST for USERINFO_HOST (one run each): the
// same URL without user info was answered by them (beacon, controlled), while with user info
// no request at all went out, from the page or a Service Worker, the frame stayed at its
// initial empty URL, and Chrome logged "Subresource requests whose URLs contain embedded
// credentials ... are blocked". So the seeding registers none for it, and one test suffices.
// If Chrome ever let it through, the frame would end on the warning page and this would fail.
test("an iframe with user info is refused by Chrome: no warning page, no load, no paint", async ({
  extension,
  server,
}) => {
  const page = await extension.context.newPage();
  const visit = server.attackerVisit("userinfo", "synthetic");

  const paints = await openTraced(page, server, visit, "iframe", async () => {
    // The load event waits for the iframe too.
    await page.waitForLoadState("load");
    await firstContentfulPaint(page.mainFrame());
  });

  await expect(page.locator("#outer")).toBeVisible();
  const frame = await placementFrame(page, "iframe");
  expect(frame.url()).not.toContain(extension.warningPageUrl);
  await expect(frame.locator("body")).not.toContainText(ATTACKER_CONTENT);
  expect(paints).toMatchObject({ committed: 0, firstPaint: 0, firstContentfulPaint: 0 });
  expect(paints.paint).toBe(0);
  expect(paints.anyDocumentFirstContentfulPaint).toBeGreaterThan(0);
  expect(server.beaconsFor(visit)).toEqual([]);
});
