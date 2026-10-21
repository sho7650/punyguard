// Keeps the block rules and the content script registered for the current settings and reports
// through the toolbar badge when blocking is off. Also sends frames that a Service Worker redirected away from a
// blocked URL to the warning page (ADR-0004).
import { createProtector } from "./core/protection.ts";
import {
  createStartTracker,
  type FrameUrl,
  redirectedFrameTarget,
} from "./core/redirect-tracking.ts";
import { loadSavedSettings, onSettingsChanged } from "./settings-storage.ts";

const WARNING_PAGE_URL = chrome.runtime.getURL("blocked.html");

const runProtection = createProtector({
  warningPageUrl: WARNING_PAGE_URL,
  loadSettings: loadSavedSettings,
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- mirrors Chrome's mutable UpdateRuleOptions
  updateDynamicRules: (options) => chrome.declarativeNetRequest.updateDynamicRules(options),
  getRegisteredContentScripts: (ids) =>
    chrome.scripting.getRegisteredContentScripts({ ids: [...ids] }),
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- mirrors Chrome's mutable RegisteredContentScript
  registerContentScripts: (scripts) => chrome.scripting.registerContentScripts([...scripts]),
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- mirrors Chrome's mutable RegisteredContentScript
  updateContentScripts: (scripts) => chrome.scripting.updateContentScripts([...scripts]),
  containsOrigins: (origins) => chrome.permissions.contains({ origins: [...origins] }),
  setBadgeText: (text) => chrome.action.setBadgeText({ text }),
  setTitle: (title) => chrome.action.setTitle({ title }),
  getMessage: (key) => chrome.i18n.getMessage(key),
  logError: (message, error) => {
    console.error(message, error);
  },
});

// runProtection does not reject: ensureProtection handles every failure it can meet itself.
function protect(): void {
  void runProtection();
}

// onInstalled fires on install, update and reload; onStartup on every browser start.
// Dynamic rules should survive a restart, but registering again does not rely on it.
chrome.runtime.onInstalled.addListener(() => {
  protect();
});
chrome.runtime.onStartup.addListener(() => {
  protect();
});
// Site access changes in chrome://extensions arrive as permission changes.
chrome.permissions.onAdded.addListener(() => {
  protect();
});
chrome.permissions.onRemoved.addListener(() => {
  protect();
});
// A change on the options page takes effect from the next navigation (CONTEXT.md).
onSettingsChanged(() => {
  protect();
});
// The toolbar icon has no popup; clicking it opens the settings.
chrome.action.onClicked.addListener(() => {
  chrome.runtime.openOptionsPage().catch((error: unknown) => {
    console.error("Failed to open the options page", error);
  });
});

const navigationStarts = createStartTracker();

// The settings are read here, after the page has committed: the redirected page may already
// have run (a known limit), and what matters is that it ends on the warning page.
async function moveRedirectedFrame(
  { tabId, frameId, url }: FrameUrl,
  start: string,
): Promise<void> {
  const settings = await loadSavedSettings();
  const target = redirectedFrameTarget({ start, committed: url }, settings, WARNING_PAGE_URL);
  if (target === null) {
    return;
  }
  // replace() takes the redirected page's place in the tab's history.
  await chrome.scripting.executeScript({
    target: { tabId, frameIds: [frameId] },
    injectImmediately: true,
    func: (warningPage: string) => {
      location.replace(warningPage);
    },
    args: [target],
  });
}

// Registered synchronously at the top level, so these events wake the service worker after
// Chrome has stopped it.
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- mirrors Chrome's mutable callback details
chrome.webNavigation.onBeforeNavigate.addListener((details) => {
  navigationStarts.started(details);
});
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- mirrors Chrome's mutable callback details
chrome.webNavigation.onCommitted.addListener((details) => {
  const start = navigationStarts.redirectedFrom(details);
  if (start === undefined) {
    return;
  }
  moveRedirectedFrame(details, start).catch((error: unknown) => {
    console.error("Failed to send a redirected frame to the warning page", error);
  });
});
chrome.tabs.onRemoved.addListener((tabId) => {
  navigationStarts.tabClosed(tabId);
});
