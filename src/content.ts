// Sends a page that a Service Worker answered, which the block rules never see, to the warning
// page (ADR-0004). Runs at document_start in every frame, so it decides before the page's own
// scripts run. It reads only the page's URL.
import { declaredSettings } from "./core/content-script.ts";
import { warningTarget } from "./core/warning-target.ts";

const target = warningTarget(
  document.URL,
  declaredSettings(globalThis),
  chrome.runtime.getURL("blocked.html"),
);
if (target !== null) {
  // replace() takes the page's place in the tab's history, so the original URL does not stay.
  location.replace(target);
}
