// Profiles where the attacker's Service Workers were registered before PunyGuard was installed,
// as when a user visited the attacker's site first (requirements V-1).
//
// Seeding took about 1 s and copying the result about 0.35 s (2026-10-20, macOS, one run). So
// each Playwright worker seeds one profile against its own server (origins include the port, so
// the server must outlive the profile) and each test gets a copy of it, which it may change and
// restart freely.
import { cpSync } from "node:fs";
import { chromium, type BrowserContext, type Frame, type Page } from "@playwright/test";
import type { BlockReason } from "./attacker-site.ts";
import { scriptPath, SERVICE_WORKER_KINDS } from "./attacker-site.ts";
import { BROWSER_ARGS, secureOriginArgs } from "./browser-flags.ts";
import { embeddedFrame } from "./embedded-frame.ts";
import { newUserDataDir } from "./extension.ts";
import type { TestServer } from "./server.ts";

// Chrome refuses a URL with user info in an iframe before any request (embedded-documents.spec.ts),
// so only these reasons get a Service Worker registered inside an iframe.
const IFRAME_REASONS: readonly BlockReason[] = ["idnHost", "ipHost"];
const ALL_REASONS: readonly BlockReason[] = ["idnHost", "ipHost", "userinfo"];

/** Chromium without PunyGuard, with the Service Worker origins treated as secure. */
export function launchWithoutExtension(
  userDataDir: string,
  server: TestServer,
  extraArgs: readonly string[] = [],
): Promise<BrowserContext> {
  return chromium.launchPersistentContext(userDataDir, {
    // The same browser that launchExtension starts, so it reads the profile the same way.
    channel: "chromium",
    args: [...BROWSER_ARGS, ...secureOriginArgs(server.origins), ...extraArgs],
  });
}

// Registers a Service Worker of every kind from the frame's origin and waits until each is
// activated. The registration page is outside every scope, so navigator.serviceWorker.ready,
// which waits for one controlling the page, would never resolve.
async function registerServiceWorkers(frame: Frame): Promise<void> {
  await frame.evaluate(
    async (scripts) => {
      await Promise.all(
        scripts.map(async (script) => {
          const registration = await navigator.serviceWorker.register(script);
          const worker = registration.installing ?? registration.waiting ?? registration.active;
          // A new registration always has a worker in one of these states; the check only narrows
          // the type.
          if (worker === null) {
            throw new Error(`No worker for ${script}`);
          }
          await new Promise<void>((resolve, reject) => {
            const settle = (): void => {
              if (worker.state === "activated") {
                resolve();
              } else if (worker.state === "redundant") {
                reject(new Error(`${script} became redundant`));
              }
            };
            worker.addEventListener("statechange", settle);
            settle();
          });
        }),
      );
    },
    SERVICE_WORKER_KINDS.map((kind) => scriptPath(kind)),
  );
}

/**
 * A new profile with a Service Worker of every kind on every reason's origin, registered at the
 * top level and, for the reasons Chrome lets into an iframe, inside an iframe on ASCII_HOST: with
 * storage partitioning, only a Service Worker registered under the same top-level site controls
 * an iframe (service-worker-controls.spec.ts).
 */
export async function seedServiceWorkerProfile(server: TestServer): Promise<string> {
  const userDataDir = newUserDataDir();
  const context = await launchWithoutExtension(userDataDir, server);
  try {
    // Each registration gets its own page, so they all run at once.
    const register = async (url: string, frame: (page: Page) => Promise<Frame>): Promise<void> => {
      const page = await context.newPage();
      await page.goto(url);
      await registerServiceWorkers(await frame(page));
      await page.close();
    };
    await Promise.all([
      ...ALL_REASONS.map((reason) =>
        register(server.registrationUrl(reason), (page) => Promise.resolve(page.mainFrame())),
      ),
      ...IFRAME_REASONS.map((reason) =>
        register(server.iframeEmbeddingUrl(server.registrationUrl(reason)), embeddedFrame),
      ),
    ]);
  } finally {
    await context.close();
  }
  return userDataDir;
}

/** A copy of the seeded profile, for one test to change freely. */
export function copyProfile(seededDir: string): string {
  const userDataDir = newUserDataDir();
  cpSync(seededDir, userDataDir, { recursive: true });
  return userDataDir;
}
