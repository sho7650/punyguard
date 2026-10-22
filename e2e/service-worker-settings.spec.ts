// The settings apply to navigations a Service Worker answers as they do to the others: a
// loosened reason lets the Service Worker's page through, and every change applies from the
// very next navigation, both ways (requirements FR-4, FR-5, V-3).
import { buildBlockRules } from "../src/blocking/block-rule.ts";
import { DEFAULT_SETTINGS, type Settings } from "../src/settings/settings.ts";
import type { BlockReason } from "./support/attacker-site.ts";
import { saveSettings, type Extension } from "./support/extension.ts";
import { test } from "./support/service-worker-fixtures.ts";
import {
  expectAttackerPage,
  expectWarningPage,
  openVisit,
} from "./support/service-worker-outcome.ts";

// Saves the settings and waits until the rules and the content script follow them.
function save(extension: Extension, settings: Settings): Promise<void> {
  const ruleIds = buildBlockRules(extension.warningPageUrl, settings).map((rule) => rule.id);
  return saveSettings(extension, settings, ruleIds);
}

// Each setting the user can loosen, and the reason whose Service Worker page it lets through.
// 127.0.0.1, the only IP address host the Service Workers are seeded on, is a private address.
// That a public address stays blocked while private ones are excluded is decided by the same
// findBlockReasons for both paths, and src/blocking/block-reasons.test.ts checks it; no Service
// Worker can be seeded on a public address here.
const LOOSENINGS: readonly {
  readonly name: string;
  readonly settings: Settings;
  readonly reason: BlockReason;
}[] = [
  {
    name: "user info blocking off",
    settings: { ...DEFAULT_SETTINGS, blockUserinfo: false },
    reason: "userinfo",
  },
  {
    name: "IP address host blocking off",
    settings: { ...DEFAULT_SETTINGS, blockIpHosts: false },
    reason: "ip",
  },
  {
    name: "private IP addresses excluded",
    settings: { ...DEFAULT_SETTINGS, excludePrivateIps: true },
    reason: "ip",
  },
];

test.describe("a setting applies to a Service Worker's page from the next navigation", () => {
  for (const { name, settings, reason } of LOOSENINGS) {
    test(`${name}: let through, then blocked again`, async ({ extension, server }) => {
      const page = await extension.context.newPage();

      const before = server.attackerVisit(reason, "synthetic");
      await openVisit(page, before);
      await expectWarningPage(page, extension, server, before, reason);

      await save(extension, settings);
      const loosened = server.attackerVisit(reason, "synthetic");
      await openVisit(page, loosened);
      await expectAttackerPage(page, server, loosened);

      await save(extension, DEFAULT_SETTINGS);
      const restored = server.attackerVisit(reason, "synthetic");
      await openVisit(page, restored);
      await expectWarningPage(page, extension, server, restored, reason);
    });
  }
});

// IDN hosts have no setting (src/settings/settings.ts), so loosening everything else leaves them
// blocked.
test("with every setting loosened, a Service Worker's page on an IDN host is blocked", async ({
  extension,
  server,
}) => {
  await save(extension, { blockUserinfo: false, blockIpHosts: false, excludePrivateIps: true });
  const page = await extension.context.newPage();
  const visit = server.attackerVisit("idn", "synthetic");

  await openVisit(page, visit);

  await expectWarningPage(page, extension, server, visit, "idn");
});
