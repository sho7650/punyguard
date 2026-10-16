// Keeps the block rule registered and reports through the toolbar badge when blocking is off.
import { createProtector } from "./core/protection.ts";

const runProtection = createProtector({
  warningPageUrl: chrome.runtime.getURL("blocked.html"),
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
