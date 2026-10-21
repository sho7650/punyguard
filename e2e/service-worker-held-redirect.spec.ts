// The attacker's Service Worker holds a blocked navigation before it redirects, long enough for
// Chrome to stop the extension's idle worker in between: it stopped after about 30 s idle, and a
// redirect held 35 s or 60 s then stayed on the attacker page every time while background.ts
// kept the starts in memory (2026-10-21). The worker must still send the frame to the warning
// page once the redirect lands (requirements FR-9, AC-4). The test stops the worker itself
// instead of waiting 30 s. The redirected page may run before it is replaced (AC-4), so this
// file does not check beacons.
import {
  PLACEMENTS,
  placementFrame,
  placementUrl,
  type Placement,
} from "./support/attacker-navigation.ts";
import type { BlockReason } from "./support/attacker-site.ts";
import { stopExtensionWorker } from "./support/extension-worker.ts";
import { expect, test } from "./support/service-worker-fixtures.ts";
import { ATTACKER_USERINFO } from "./support/server.ts";

const REASON_SECTIONS: Readonly<Record<BlockReason, string>> = {
  idn: "#reason-idnHost",
  ip: "#reason-ipHost",
  userinfo: "#reason-userinfo",
};

// Chrome refuses a URL with user info in an iframe before any request, so no Service Worker is
// asked (service-worker-redirect.spec.ts).
const COMBINATIONS = (["idn", "ip", "userinfo"] as const).flatMap((reason: BlockReason) =>
  PLACEMENTS.filter((placement: Placement) => reason !== "userinfo" || placement === "top").map(
    (placement) => ({ reason, placement }),
  ),
);

test.describe("a redirect that lands after the extension's worker stopped ends on the warning page", () => {
  for (const { reason, placement } of COMBINATIONS) {
    test(`${reason}, ${placement}`, async ({ extension, server }) => {
      const page = await extension.context.newPage();
      const visit = server.attackerVisit(reason, "redirectAfterHold");
      const masked = visit.url.replace(`${ATTACKER_USERINFO}@`, "user:***@");

      // A CDP command on a page whose navigation a Service Worker holds got no answer until the
      // test timed out (2026-10-21), so another page, opened before that navigation, stops the
      // worker: opening a page after it would start the worker again (extension-worker.ts).
      const controlPage = await extension.context.newPage();
      const navigation = page.goto(placementUrl(server, visit, placement), {
        waitUntil: "commit",
      });
      await expect.poll(() => server.isHeld(visit)).toBe(true);
      await stopExtensionWorker(extension, controlPage);
      server.releaseHold(visit);
      await navigation;

      const frame = await placementFrame(page, placement);
      await expect.poll(() => frame.url()).toBe(`${extension.warningPageUrl}#${masked}`);
      await expect(frame.locator(REASON_SECTIONS[reason])).toBeVisible();
    });
  }
});
