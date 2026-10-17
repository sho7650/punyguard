// What the user can loosen on the options page. IDN hosts are always blocked (ADR-0001), so
// they have no setting.
export interface Settings {
  readonly blockUserinfo: boolean;
  readonly blockIpHosts: boolean;
  readonly excludePrivateIps: boolean;
}

// Everything blocked: the state after install and whenever the stored settings are unusable.
export const DEFAULT_SETTINGS: Settings = {
  blockUserinfo: true,
  blockIpHosts: true,
  excludePrivateIps: false,
};

const SETTING_NAMES = ["blockUserinfo", "blockIpHosts", "excludePrivateIps"] as const;

function parseSettings(saved: unknown): Settings | null {
  if (typeof saved !== "object" || saved === null) {
    return null;
  }
  const [blockUserinfo, blockIpHosts, excludePrivateIps] = SETTING_NAMES.map((name): unknown =>
    Reflect.get(saved, name),
  );
  return typeof blockUserinfo === "boolean" &&
    typeof blockIpHosts === "boolean" &&
    typeof excludePrivateIps === "boolean"
    ? { blockUserinfo, blockIpHosts, excludePrivateIps }
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
