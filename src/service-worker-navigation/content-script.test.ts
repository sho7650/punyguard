/// <reference types="node" />
import { createContext, runInContext } from "node:vm";
import { describe, expect, test } from "vitest";
import { contentScriptRegistration, declaredSettings, settingsScripts } from "./content-script.ts";
import { DEFAULT_SETTINGS, type Settings } from "../settings/settings.ts";

const everySettings: readonly Settings[] = [false, true].flatMap((blockUserinfo) =>
  [false, true].flatMap((blockIpHosts) =>
    [false, true].map((excludePrivateIps) => ({ blockUserinfo, blockIpHosts, excludePrivateIps })),
  ),
);

// Runs the scripts a registration loads, the way Chrome would in the content script's world,
// and returns what the last one (the content script) reads as its settings.
function settingsSeenByContentScript(settings: Settings): Settings {
  const scripts = contentScriptRegistration(settings).js ?? [];
  expect(scripts.at(-1)).toBe("content.js");
  const world = createContext({});
  for (const path of scripts.slice(0, -1)) {
    const script = settingsScripts().find((file) => file.path === path);
    if (script === undefined) {
      throw new Error(`The build writes no ${path}`);
    }
    runInContext(script.source, world);
  }
  return declaredSettings(world);
}

describe("contentScriptRegistration", () => {
  // The page's own scripts must not get to run first, in the page or in any of its frames.
  test("runs in every frame of http and https pages, before the page's scripts", () => {
    expect(contentScriptRegistration(DEFAULT_SETTINGS)).toMatchObject({
      id: "block-service-worker-pages",
      matches: ["http://*/*", "https://*/*"],
      allFrames: true,
      runAt: "document_start",
    });
  });

  test.each(everySettings)(
    "hands the content script the settings %o before it runs",
    (settings) => {
      expect(settingsSeenByContentScript(settings)).toEqual(settings);
    },
  );
});
