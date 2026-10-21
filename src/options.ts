// The options page. Each change is saved at once; there is no save button.
import type { Settings } from "./core/settings.ts";
import { localize } from "./localize.ts";
import { loadSavedSettings, onSettingsChanged, saveSettings } from "./settings-storage.ts";

type SettingName = keyof Settings;

const SETTING_NAMES: readonly SettingName[] = [
  "blockUserinfo",
  "blockIpHosts",
  "excludePrivateIps",
];

function checkbox(name: SettingName): HTMLInputElement {
  const element = document.querySelector(`#${name}`);
  // Only narrows the type: options.html ships with this script, so a missing checkbox is a
  // build mistake, not something that happens at run time.
  if (!(element instanceof HTMLInputElement)) {
    throw new TypeError(`options.html has no <input> with id "${name}"`);
  }
  return element;
}

function showSettings(settings: Settings): void {
  for (const name of SETTING_NAMES) {
    checkbox(name).checked = settings[name];
  }
  // The exclusion has no effect while IP address hosts are not blocked. It keeps its value, so
  // turning that blocking back on brings the user's choice back with it.
  checkbox("excludePrivateIps").disabled = !settings.blockIpHosts;
}

function readForm(): Settings {
  return {
    blockUserinfo: checkbox("blockUserinfo").checked,
    blockIpHosts: checkbox("blockIpHosts").checked,
    excludePrivateIps: checkbox("excludePrivateIps").checked,
  };
}

function showSaveFailed(failed: boolean): void {
  const message = document.querySelector("#save-failed");
  // Only narrows the type, as in checkbox().
  if (!(message instanceof HTMLElement)) {
    throw new TypeError('options.html has no element with id "save-failed"');
  }
  message.hidden = !failed;
}

async function refresh(): Promise<void> {
  showSettings(await loadSavedSettings());
}

// A failed save puts the form back to what is actually saved, so it never shows a setting that
// is not in effect.
async function save(): Promise<void> {
  const settings = readForm();
  showSettings(settings);
  try {
    await saveSettings(settings);
    showSaveFailed(false);
  } catch (error) {
    console.error("Failed to save the settings", error);
    showSaveFailed(true);
    await refresh();
  }
}

// save and refresh do not reject: loadSavedSettings never rejects, save catches a failed
// storage write itself, and the only other throw is showSettings finding no checkbox in the
// static options.html, a build mistake.
function listenForChanges(): void {
  for (const name of SETTING_NAMES) {
    checkbox(name).addEventListener("change", () => {
      void save();
    });
  }
  // Another options tab may change the settings too.
  onSettingsChanged(() => {
    void refresh();
  });
}

// The listeners go on after the saved settings are shown, so a click cannot save the blank form.
function start(): void {
  localize();
  void refresh().then(listenForChanges);
}

start();
