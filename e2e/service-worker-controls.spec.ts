// Controls for the Service Worker tests: that the browser partitions storage as real Chrome
// does, that the seeded Service Workers answer and their pages are observable without
// PunyGuard, that the paint count is not fooled, and that the extension's worker really stops.
// Without these, "no beacon, no paint" in the blocking tests could mean "nothing was observable".
import type { BrowserContext, Page } from "@playwright/test";
import {
  attackerPagePainted,
  firstContentfulPaint,
  openTraced,
  PLACEMENTS,
  placementFrame,
  type Placement,
} from "./support/attacker-navigation.ts";
import type { BlockReason } from "./support/attacker-site.ts";
import { PLAYWRIGHT_DISABLED_FEATURES } from "./support/browser-flags.ts";
import { dynamicRuleIds, DEFAULT_RULE_IDS } from "./support/extension.ts";
import {
  extensionWorkerStatus,
  startExtensionWorker,
  stopExtensionWorker,
} from "./support/extension-worker.ts";
import { expect, test } from "./support/service-worker-fixtures.ts";
import { launchWithoutExtension } from "./support/service-worker-profile.ts";
import type { AttackerVisit, TestServer } from "./support/server.ts";

// Brings back Playwright's own switch, partitioning off included.
const PARTITIONING_OFF = `--disable-features=${PLAYWRIGHT_DISABLED_FEATURES.join(",")}`;

async function withoutExtension(
  profileDir: string,
  server: TestServer,
  run: (context: BrowserContext) => Promise<void>,
  extraArgs: readonly string[] = [],
): Promise<void> {
  const context = await launchWithoutExtension(profileDir, server, extraArgs);
  try {
    await run(context);
  } finally {
    await context.close();
  }
}

// Opens the visit, waits for its beacon and returns whether a Service Worker controlled it.
async function controlledWhenOpened(
  page: Page,
  server: TestServer,
  visit: AttackerVisit,
  url: string,
): Promise<boolean> {
  await page.goto(url);
  await expect.poll(() => server.beaconsFor(visit).length).toBe(1);
  // The poll just confirmed one beacon; ?? only narrows the type.
  return server.beaconsFor(visit)[0]?.controlled ?? false;
}

test("the browser gets Playwright's disabled features, except storage partitioning", async ({
  profileDir,
  server,
}) => {
  await withoutExtension(profileDir, server, async (context) => {
    const page = await context.newPage();
    await page.goto("chrome://version");
    const commandLine = await page.locator("#command_line").innerText();
    // The group always matches; ?. only narrows the type.
    const disabled = [...commandLine.matchAll(/--disable-features=(\S+)/gu)].map(([, features]) =>
      features?.split(","),
    );

    // Chromium uses the last one (browser-flags.ts).
    expect(disabled).toEqual([
      PLAYWRIGHT_DISABLED_FEATURES,
      PLAYWRIGHT_DISABLED_FEATURES.filter((feature) => feature !== "ThirdPartyStoragePartitioning"),
    ]);
  });
});

test("the browser partitions Service Workers by the top-level site", async ({
  profileDir,
  server,
}) => {
  await withoutExtension(profileDir, server, async (context) => {
    const page = await context.newPage();
    const open = (url: (visit: AttackerVisit) => string): Promise<boolean> => {
      const visit = server.attackerVisit("idn", "synthetic");
      return controlledWhenOpened(page, server, visit, url(visit));
    };

    expect(await open((visit) => visit.url)).toBe(true);
    // Registered from an iframe on ASCII_HOST (service-worker-profile.ts)
    expect(await open((visit) => server.iframeEmbeddingUrl(visit.url))).toBe(true);
    // Nothing was registered under 127.0.0.1 as the top-level site, and the Service Worker
    // registered at the top level does not reach into another site's iframe.
    expect(await open((visit) => server.iframeEmbeddingUrl(visit.url, "ip"))).toBe(false);
  });
});

// Shows that the last check tells partitioning on from off: with Playwright's own switch, the
// Service Worker registered at the top level controls the iframe as well.
test("with partitioning off, the top-level Service Worker controls the iframe too", async ({
  profileDir,
  server,
}) => {
  await withoutExtension(
    profileDir,
    server,
    async (context) => {
      const page = await context.newPage();
      const visit = server.attackerVisit("idn", "synthetic");
      const url = server.iframeEmbeddingUrl(visit.url, "ip");

      expect(await controlledWhenOpened(page, server, visit, url)).toBe(true);
    },
    [PARTITIONING_OFF],
  );
});

// Chrome itself keeps two kinds of combination from ever showing the attacker's page, so they
// have no positive control and the blocking tests check them as Chrome's refusal:
// - user info with the relay: the navigation fails with net::ERR_FAILED and shows Chrome's error
//   page, with no beacon (2026-10-20, this setup without PunyGuard, 5 of 5; the same as the
//   2026-10-18 research with PunyGuard)
// - user info in an iframe: Chrome refuses the document before any request
//   (embedded-documents.spec.ts), so no Service Worker is even asked
const COMBINATIONS = (["idn", "ip", "userinfo"] as const).flatMap((reason: BlockReason) =>
  (["relay", "synthetic"] as const).flatMap((kind) =>
    PLACEMENTS.filter(
      (placement: Placement) =>
        reason !== "userinfo" || (kind === "synthetic" && placement === "top"),
    ).map((placement) => ({ reason, kind, placement })),
  ),
);

test.describe("without PunyGuard, the seeded Service Worker's page is observed", () => {
  for (const { reason, kind, placement } of COMBINATIONS) {
    test(`${reason}, ${kind}, ${placement}: its beacon arrives and it is painted`, async ({
      profileDir,
      server,
    }) => {
      await withoutExtension(profileDir, server, async (context) => {
        const page = await context.newPage();
        const visit = server.attackerVisit(reason, kind);

        const paints = await openTraced(page, server, visit, placement, async () => {
          await expect.poll(() => server.beaconsFor(visit).length).toBe(1);
          await attackerPagePainted(page, placement);
        });

        expect(server.beaconsFor(visit)).toEqual([
          {
            visit: visit.id,
            servedBy: kind === "relay" ? "network" : "serviceWorker",
            controlled: true,
          },
        ]);
        // Each counter catches the paint, so a zero from any of them means something.
        expect(paints).toMatchObject({ committed: 1, firstPaint: 1, firstContentfulPaint: 1 });
        expect(paints.paint).toBeGreaterThan(0);
      });
    });
  }
});

// The block rules stop these before any document commits, so no attacker paint can exist. The
// warning page and the embedding page do paint, and must not count.
test.describe("with PunyGuard and no Service Worker, the paint count stays at zero", () => {
  for (const placement of PLACEMENTS) {
    test(placement, async ({ extension, server }) => {
      const page = await extension.context.newPage();
      const visit = server.attackerVisit("idn", "none");

      const paints = await openTraced(page, server, visit, placement, async () => {
        const frame = await placementFrame(page, placement);
        await expect(frame.locator("#reason-idnHost")).toBeVisible();
        await firstContentfulPaint(frame);
      });

      expect(paints).toMatchObject({ committed: 0, firstPaint: 0, firstContentfulPaint: 0 });
      expect(paints.paint).toBe(0);
      expect(paints.anyDocumentFirstContentfulPaint).toBeGreaterThan(0);
      expect(server.beaconsFor(visit)).toEqual([]);
    });
  }
});

test("stopping the extension's worker stops it until the next navigation", async ({
  extension,
  server,
}) => {
  const page = await extension.context.newPage();
  await stopExtensionWorker(extension, page);
  expect(await extensionWorkerStatus(extension, page)).toBe("stopped");

  // webNavigation starts it, so the navigation that follows a stop meets a stopped worker.
  await page.goto(server.asciiUrl("/"));
  await expect.poll(() => extensionWorkerStatus(extension, page)).toBe("running");
  expect(await dynamicRuleIds(extension.worker)).toEqual(new Set(DEFAULT_RULE_IDS));

  await stopExtensionWorker(extension, page);
  await startExtensionWorker(extension, page);
  expect(await dynamicRuleIds(extension.worker)).toEqual(new Set(DEFAULT_RULE_IDS));
});
