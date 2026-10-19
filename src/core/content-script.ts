import type { Settings } from "./settings.ts";

// A file Chrome loads before the content script, written into dist/ by scripts/build.ts
export interface SettingsScript {
  readonly path: string;
  readonly source: string;
}

// The content script has to decide before the page's scripts run, so it cannot wait for
// chrome.storage. The settings reach it instead through a script loaded just before it, one
// per combination of settings, that declares them in the content scripts' world. The page
// cannot see or change that world.
const SETTINGS_GLOBAL = "punyguardSettings";

const EVERY_SETTINGS: readonly Settings[] = [false, true].flatMap((blockUserinfo) =>
  [false, true].flatMap((blockIpHosts) =>
    [false, true].map((excludePrivateIps) => ({ blockUserinfo, blockIpHosts, excludePrivateIps })),
  ),
);

// One digit per setting, in the order of Settings: content-settings/110.js is the default.
function settingsScriptPath(settings: Settings): string {
  const digits = [settings.blockUserinfo, settings.blockIpHosts, settings.excludePrivateIps]
    .map(Number)
    .join("");
  return `content-settings/${digits}.js`;
}

export function settingsScripts(): readonly SettingsScript[] {
  return EVERY_SETTINGS.map((settings) => ({
    path: settingsScriptPath(settings),
    source: `globalThis.${SETTINGS_GLOBAL} = ${JSON.stringify(settings)};\n`,
  }));
}

// What the settings script declared in this world. It is always there and well formed, so it
// is not checked: Chrome injects the files of one registration in order into the same isolated
// world, so the settings script listed just before content.js has run in every frame
// content.js runs in. Neither the page nor other extensions can reach that world, and the
// sources are JSON.stringify of a Settings. If a file of the registration is missing, Chrome
// refuses the registration as a whole (ensureProtection shows that with the ! badge).
export function declaredSettings(world: object): Settings {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- always set as a Settings (above)
  return Reflect.get(world, SETTINGS_GLOBAL) as Settings;
}

// The content script that sends pages a Service Worker answered to the warning page
// (ADR-0004). One fixed ID, so registering again updates it instead of adding another.
export function contentScriptRegistration(
  settings: Settings,
): chrome.scripting.RegisteredContentScript {
  return {
    id: "block-service-worker-pages",
    matches: ["http://*/*", "https://*/*"],
    allFrames: true,
    runAt: "document_start",
    js: [settingsScriptPath(settings), "content.js"],
  };
}
