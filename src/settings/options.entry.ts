// The options page. Each change is saved at once; there is no save button.
import { SETTING_NAMES, type SettingName, type Settings, settingsFrom } from "./settings.ts";
import { localize } from "../i18n/localize.dom.ts";
import { loadSavedSettings, onSettingsChanged, saveSettings } from "./settings-storage.chrome.ts";

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
  return settingsFrom((name) => checkbox(name).checked);
}

function showSaveFailed(failed: boolean): void {
  const message = document.querySelector("#save-failed");
  // Only narrows the type, as in checkbox().
  if (!(message instanceof HTMLElement)) {
    throw new TypeError('options.html has no element with id "save-failed"');
  }
  message.hidden = !failed;
}

// Every save makes this tab reload too, and the user can change another setting before that
// reload ends. A reload that a later save or reload has overtaken is not shown, because the next
// change saves the whole form and would undo the user's change. A save shows #save-failed and
// rolls back only while it is the latest save: its own reload would otherwise overtake every save.
let latestFormOperation = 0;
let latestSave = 0;

async function refresh(): Promise<void> {
  latestFormOperation += 1;
  const thisOperation = latestFormOperation;
  const settings = await loadSavedSettings();
  if (thisOperation === latestFormOperation) {
    showSettings(settings);
  }
}

// A failed save puts the form back to what is actually saved, so it never shows a setting that
// is not in effect.
async function save(): Promise<void> {
  latestFormOperation += 1;
  latestSave += 1;
  const thisSave = latestSave;
  const settings = readForm();
  showSettings(settings);
  try {
    await saveSettings(settings);
    if (thisSave === latestSave) {
      showSaveFailed(false);
    }
  } catch (error) {
    console.error("Failed to save the settings", error);
    // A later save writes the whole form, this change included, so its result stands instead.
    if (thisSave === latestSave) {
      showSaveFailed(true);
      await refresh();
    }
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
