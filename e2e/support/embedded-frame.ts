// Playwright's frameLocator takes only an iframe, so the document inside an <object> or an
// <embed> is found among the page's frames instead.
import { expect, type Frame, type Page } from "@playwright/test";

/** The page's only embedded document, waiting until it exists. */
export async function embeddedFrame(page: Page): Promise<Frame> {
  const childFrames = (): Frame[] => page.frames().filter((frame) => frame !== page.mainFrame());
  await expect.poll(() => childFrames().length).toBe(1);
  const [frame] = childFrames();
  if (frame === undefined) {
    throw new Error("The embedded document disappeared");
  }
  return frame;
}
