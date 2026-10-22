// Reads and writes the settings in chrome.storage.local, shared by the service worker, the
// warning page and the options page. Local only: nothing is synced (ADR-0003).
import { loadSettings, type Settings } from "./settings.ts";

const SETTINGS_KEY = "settings";

export function loadSavedSettings(): Promise<Settings> {
  return loadSettings(
    async () => {
      const items = await chrome.storage.local.get(SETTINGS_KEY);
      return items[SETTINGS_KEY];
    },
    (message, error) => {
      console.error(message, error);
    },
  );
}

export function saveSettings(settings: Settings): Promise<void> {
  return chrome.storage.local.set({ [SETTINGS_KEY]: settings });
}

// Calls onChange when the saved settings change, from any page.
export function onSettingsChanged(onChange: () => void): void {
  // "settings" is the only key this extension keeps in storage.local, so every change is to it.
  chrome.storage.local.onChanged.addListener(() => {
    onChange();
  });
}
