// Opens an attacker URL as a whole page or inside an iframe, with the paint trace around it.
import { expect, type Frame, type Page } from "@playwright/test";
import { ATTACKER_CONTENT } from "./attacker-site.ts";
import { embeddedFrame } from "./embedded-frame.ts";
import { startPaintTrace, type AttackerPaints } from "./paint-trace.ts";
import type { AttackerVisit, TestServer } from "./server.ts";

/** Whether the attacker URL is the whole page or the document of an iframe on ASCII_HOST. */
export type Placement = "top" | "iframe";

export const PLACEMENTS: readonly Placement[] = ["top", "iframe"];

/** The URL to open for the visit: its own, or the page that embeds it in an iframe. */
export function placementUrl(
  server: TestServer,
  visit: AttackerVisit,
  placement: Placement,
): string {
  return placement === "top" ? visit.url : server.iframeEmbeddingUrl(visit.url);
}

/** The frame that holds the visit's document: the page's own, or its only iframe. */
export function placementFrame(page: Page, placement: Placement): Promise<Frame> {
  return placement === "top" ? Promise.resolve(page.mainFrame()) : embeddedFrame(page);
}

/**
 * Opens the visit and counts the attacker's paints until `settled` resolves. `settled` waits for
 * the end state the test expects (the warning page, a beacon); the attacker document's paints
 * end at the next commit in its frame, so they are all in the trace once a later page shows.
 * Waits for the first commit only, since the page may move on right away.
 */
export async function openTraced(
  page: Page,
  server: TestServer,
  visit: AttackerVisit,
  placement: Placement,
  settled: () => Promise<void>,
): Promise<AttackerPaints> {
  const trace = await startPaintTrace(page, visit);
  await page.goto(placementUrl(server, visit, placement), { waitUntil: "commit" });
  await settled();
  return trace.stop();
}

/**
 * Waits until the frame's document reports its first contentful paint to its own scripts. The
 * trace can get the matching event later than the paint: 2026-10-20, stopping the trace two
 * animation frames after the attacker page showed lost the event in 1 of 9 positive controls.
 */
export async function firstContentfulPaint(frame: Frame): Promise<void> {
  await frame.waitForFunction(
    () => performance.getEntriesByName("first-contentful-paint").length > 0,
  );
}

/** Waits until the attacker page shows in the frame and has been painted. */
export async function attackerPagePainted(page: Page, placement: Placement): Promise<void> {
  const frame = await placementFrame(page, placement);
  await expect(frame.locator("h1")).toHaveText(ATTACKER_CONTENT);
  await firstContentfulPaint(frame);
}
