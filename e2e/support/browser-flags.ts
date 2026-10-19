// Command-line switches every test browser gets, with and without the extension.
import { ASCII_HOST, IDN_HOST, USERINFO_HOST } from "./server.ts";

// The features Playwright 1.64.1 turns off with its own --disable-features switch: the
// disabledFeatures list in playwright-core/lib/coreBundle.js (chromiumSwitches.ts in the
// Playwright source). e2e/service-worker-controls.spec.ts compares this list with the switch
// Playwright actually passes, so an upgrade that changes it fails there.
export const PLAYWRIGHT_DISABLED_FEATURES: readonly string[] = [
  "AvoidUnnecessaryBeforeUnloadCheckSync",
  "DestroyProfileOnBrowserClose",
  "DialMediaRouteProvider",
  "GlobalMediaControls",
  "HttpsUpgrades",
  "LensOverlay",
  "MediaRouter",
  "PaintHolding",
  "ThirdPartyStoragePartitioning",
  "BlockOriginHeaderModificationOnRedirect",
  "AvoidCorsURLLoaderRestartOnRedirect",
  "Translate",
  "AutoDeElevate",
  "OptimizationHints",
  "NetworkTimeServiceQuerying",
  "AimEnabled",
  "msForceBrowserSignIn",
  "msEdgeUpdateLaunchServicesPreferredVersion",
];

// Real Chrome partitions third-party storage, and with it Service Workers: one registered at the
// top level does not control the same origin in another site's iframe. Playwright turns
// partitioning off, so the Service Worker tests would pass for a setup no user has. Chromium
// uses the last --disable-features switch, so this one, without ThirdPartyStoragePartitioning,
// replaces Playwright's. Every spec gets it, since every user has partitioning; the specs that
// existed before it passed unchanged (2026-10-20, a full run).
const PARTITIONING_ON = `--disable-features=${PLAYWRIGHT_DISABLED_FEATURES.filter(
  (feature) => feature !== "ThirdPartyStoragePartitioning",
).join(",")}`;

export const BROWSER_ARGS: readonly string[] = [
  `--host-resolver-rules=MAP ${IDN_HOST} 127.0.0.1, MAP ${ASCII_HOST} 127.0.0.1, MAP ${USERINFO_HOST} 127.0.0.1`,
  PARTITIONING_ON,
];

// Service Workers only run on secure origins, and the test server speaks plain HTTP.
export function secureOriginArgs(origins: readonly string[]): readonly string[] {
  return [`--unsafely-treat-insecure-origin-as-secure=${origins.join(",")}`];
}
