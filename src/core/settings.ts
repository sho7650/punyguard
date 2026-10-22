// What the user can loosen on the options page, one on/off switch each. IDN hosts are always
// blocked (ADR-0001), so they have no setting. The names are the keys saved in storage
// (ADR-0005) and the ids of the checkboxes in options.html. The order is the order of the
// digits in the settings script names (content-script.ts).
export const SETTING_NAMES = ["blockUserinfo", "blockIpHosts", "excludePrivateIps"] as const;

export type SettingName = (typeof SETTING_NAMES)[number];

export type Settings = Readonly<Record<SettingName, boolean>>;

// Everything blocked: the state after install and whenever the stored settings are unusable.
export const DEFAULT_SETTINGS: Settings = {
  blockUserinfo: true,
  blockIpHosts: true,
  excludePrivateIps: false,
};

// Builds Settings from the value of each setting, given its name and its place in SETTING_NAMES.
export function settingsFrom(valueOf: (name: SettingName, index: number) => boolean): Settings {
  const entries = SETTING_NAMES.map((name, index) => [name, valueOf(name, index)]);
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- one entry per SettingName
  return Object.fromEntries(entries) as Settings;
}

// Keeps only the settings, so anything else in the saved object is dropped.
function parseSettings(saved: unknown): Settings | null {
  if (typeof saved !== "object" || saved === null) {
    return null;
  }
  return SETTING_NAMES.every((name) => typeof Reflect.get(saved, name) === "boolean")
    ? settingsFrom((name) => Reflect.get(saved, name) === true)
    : null;
}

// readSaved resolves to what was saved, or undefined when nothing has been saved yet. Anything
// unusable falls back to DEFAULT_SETTINGS as a whole: fixing one field at a time could leave
// blocking looser than the user chose (ADR-0003).
export async function loadSettings(
  readSaved: () => Promise<unknown>,
  logError: (message: string, error: unknown) => void,
): Promise<Settings> {
  let saved: unknown;
  try {
    saved = await readSaved();
  } catch (error) {
    logError("Failed to read the settings", error);
    return DEFAULT_SETTINGS;
  }
  if (saved === undefined) {
    return DEFAULT_SETTINGS;
  }
  const settings = parseSettings(saved);
  if (settings === null) {
    logError("The saved settings are broken", saved);
    return DEFAULT_SETTINGS;
  }
  return settings;
}
