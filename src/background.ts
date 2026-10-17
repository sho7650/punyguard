// Keeps the block rules registered for the current settings and reports through the toolbar
// badge when blocking is off.
import { createProtector } from "./core/protection.ts";
import { loadSavedSettings, onSettingsChanged } from "./settings-storage.ts";

const runProtection = createProtector({
  warningPageUrl: chrome.runtime.getURL("blocked.html"),
  loadSettings: loadSavedSettings,
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- mirrors Chrome's mutable UpdateRuleOptions
  updateDynamicRules: (options) => chrome.declarativeNetRequest.updateDynamicRules(options),
  containsOrigins: (origins) => chrome.permissions.contains({ origins: [...origins] }),
  setBadgeText: (text) => chrome.action.setBadgeText({ text }),
  setTitle: (title) => chrome.action.setTitle({ title }),
  getMessage: (key) => chrome.i18n.getMessage(key),
  logError: (message, error) => {
    console.error(message, error);
  },
});

function protect(): void {
  runProtection().catch((error: unknown) => {
    // ensureProtection handles rule and permission failures itself; only the badge or
    // tooltip update can end up here.
    console.error("Failed to update the toolbar icon", error);
  });
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
