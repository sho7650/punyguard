import { describe, expect, test } from "vitest";
import { DEFAULT_SETTINGS, loadSettings } from "./settings.ts";

async function load(read: () => Promise<unknown>) {
  const errors: { message: string; error: unknown }[] = [];
  const settings = await loadSettings(read, (message, error) => {
    errors.push({ message, error });
  });
  return { settings, errors };
}

describe("loadSettings", () => {
  test("uses everything blocked, without an error, when nothing has been saved yet", async () => {
    const { settings, errors } = await load(() => Promise.resolve());

    expect(settings).toEqual({ blockUserinfo: true, blockIpHosts: true, excludePrivateIps: false });
    expect(errors).toEqual([]);
  });

  test("returns the saved settings", async () => {
    const saved = { blockUserinfo: false, blockIpHosts: true, excludePrivateIps: true };

    const { settings, errors } = await load(() => Promise.resolve(saved));

    expect(settings).toEqual(saved);
    expect(errors).toEqual([]);
  });

  // Fixing one field at a time could leave blocking looser than intended: here it would keep
  // IP address hosts unblocked.
  test.each([
    {
      name: "one field is not a boolean",
      saved: { blockUserinfo: "broken", blockIpHosts: false, excludePrivateIps: true },
    },
    { name: "a field is missing", saved: { blockUserinfo: false, blockIpHosts: false } },
    { name: "it is not an object", saved: "blockIpHosts=false" },
    { name: "it is null", saved: null },
  ] as const)(
    "falls back to everything blocked and logs an error when $name",
    async ({ saved }) => {
      const { settings, errors } = await load(() => Promise.resolve(saved));

      expect(settings).toEqual(DEFAULT_SETTINGS);
      expect(errors).toEqual([{ message: "The saved settings are broken", error: saved }]);
    },
  );

  test("falls back to everything blocked and logs the error when reading fails", async () => {
    const failure = new Error("storage is unavailable");

    const { settings, errors } = await load(() => Promise.reject(failure));

    expect(settings).toEqual(DEFAULT_SETTINGS);
    expect(errors).toEqual([{ message: "Failed to read the settings", error: failure }]);
  });
});
