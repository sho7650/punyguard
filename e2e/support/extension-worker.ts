// Stops the extension's service worker, as Chrome does when it has been idle, so that a test can
// check that blocking does not depend on it running (requirements AC-3, AC-4).
//
// Chrome's own status (the CDP ServiceWorker domain) is what tells whether the worker runs.
// Playwright's Worker does not: measured 2026-10-20 (Chromium 156, Playwright 1.64.1), it fires
// no "close" and stays in context.serviceWorkers() while the worker is stopped, its evaluate()
// waits without starting the worker (no answer in 3 s), and the same Worker answers again once
// the worker is started. So keep using extension.worker, but only while the worker runs.
import { expect, type CDPSession, type Page } from "@playwright/test";
import type { Extension } from "./extension.ts";

export type RunningStatus = "stopped" | "starting" | "running" | "stopping";

interface WorkerVersion {
  readonly versionId: string;
  readonly runningStatus: RunningStatus;
}

interface VersionWatch {
  readonly session: CDPSession;
  /** The extension's version as last reported. */
  readonly current: () => WorkerVersion | undefined;
}

// The ServiceWorker domain reports every version in the profile, the extension's included, to a
// session on any page, and reports them all as soon as it is enabled (measured 2026-10-20 on an
// http page; Phase 0 used an extension page).
async function watchExtensionVersion(page: Page, extension: Extension): Promise<VersionWatch> {
  const session = await page.context().newCDPSession(page);
  const scriptPrefix = `chrome-extension://${extension.id}/`;
  let current: WorkerVersion | undefined = undefined;
  session.on("ServiceWorker.workerVersionUpdated", ({ versions }) => {
    for (const { versionId, scriptURL, runningStatus } of versions) {
      if (scriptURL.startsWith(scriptPrefix)) {
        current = { versionId, runningStatus };
      }
    }
  });
  await session.send("ServiceWorker.enable");
  await expect.poll(() => current).toBeDefined();
  return { session, current: () => current };
}

// watchExtensionVersion polls until a version has arrived; ?? only narrows the type.
function versionIdOf(watch: VersionWatch): string {
  return watch.current()?.versionId ?? "";
}

/** Chrome's running status of the extension's worker now. */
export async function extensionWorkerStatus(
  extension: Extension,
  page: Page,
): Promise<RunningStatus | undefined> {
  const watch = await watchExtensionVersion(page, extension);
  const status = watch.current()?.runningStatus;
  await watch.session.detach();
  return status;
}

/**
 * Stops the extension's worker and waits until Chrome reports it stopped. The session lives on
 * `page`, which should be the page the test navigates next: the webNavigation listeners start
 * the worker again on any navigation, and opening another page did too (2026-10-20, running
 * again within 1 s).
 */
export async function stopExtensionWorker(extension: Extension, page: Page): Promise<void> {
  const watch = await watchExtensionVersion(page, extension);
  await watch.session.send("ServiceWorker.stopWorker", { versionId: versionIdOf(watch) });
  await expect.poll(() => watch.current()?.runningStatus).toBe("stopped");
  await watch.session.detach();
}

/** Starts the stopped worker without a navigation and waits until it runs. */
export async function startExtensionWorker(extension: Extension, page: Page): Promise<void> {
  const watch = await watchExtensionVersion(page, extension);
  await watch.session.send("ServiceWorker.startWorker", {
    scopeURL: `chrome-extension://${extension.id}/`,
  });
  await expect.poll(() => watch.current()?.runningStatus).toBe("running");
  await watch.session.detach();
}
