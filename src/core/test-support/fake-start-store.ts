// An in-memory StartStore, standing in for chrome.storage.session in the unit tests.
import type { StartStore } from "../redirect-tracking.ts";

export interface FakeStartStore {
  readonly store: StartStore;
  // Every value the store holds now, to check what is kept
  readonly values: () => readonly unknown[];
}

export function createFakeStartStore(): FakeStartStore {
  let items: ReadonlyMap<string, string> = new Map();
  const store: StartStore = {
    get: (key) => Promise.resolve(items.get(key)),
    set: (key, value) => {
      items = new Map(items).set(key, value);
      return Promise.resolve();
    },
    remove: (keys) => {
      items = new Map([...items].filter(([key]: readonly [string, string]) => !keys.includes(key)));
      return Promise.resolve();
    },
    keys: () => Promise.resolve([...items.keys()]),
  };
  return { store, values: () => [...items.values()] };
}
