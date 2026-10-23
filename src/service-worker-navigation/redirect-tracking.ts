import { DEFAULT_SETTINGS, type Settings } from "../settings/settings.ts";
import { meetsBlockReason } from "../blocking/block-reasons.ts";
import { maskPassword } from "../blocking/password-mask.ts";
import { warningTarget } from "./warning-target.ts";

// A navigation in one frame, from the URL it started at to the URL it committed at
export interface FrameNavigation {
  readonly start: string;
  readonly committed: string;
}

// Where to send a frame whose navigation started at a blocked URL but committed somewhere else,
// because a Service Worker answered with a redirect (ADR-0004), or null to leave it. A frame
// that committed at the warning page was moved by the block rules, and one that committed at a
// blocked URL is moved by the content script. The start is always a URL the default settings
// block (createStartTracker keeps no other), but the saved settings may let it through.
export function redirectedFrameTarget(
  navigation: FrameNavigation,
  settings: Settings,
  warningPageUrl: string,
): string | null {
  const movedAlready =
    navigation.committed.startsWith(warningPageUrl) ||
    meetsBlockReason(navigation.committed, settings);
  return movedAlready ? null : warningTarget(navigation.start, settings, warningPageUrl);
}

// Which frame of which tab a webNavigation event is about
export interface FrameId {
  readonly tabId: number;
  readonly frameId: number;
}

// A webNavigation event that carries the frame's URL
export type FrameUrl = FrameId & { readonly url: string };

// An onCommitted event: how the frame got to the URL it committed at
export type FrameCommit = FrameId & { readonly transitionQualifiers: readonly string[] };

// Where the starts are kept: chrome.storage.session, which outlives the extension's worker
export interface StartStore {
  readonly get: (key: string) => Promise<unknown>;
  readonly set: (key: string, value: string) => Promise<void>;
  readonly remove: (keys: readonly string[]) => Promise<void>;
  readonly keys: () => Promise<readonly string[]>;
}

export interface StartTracker {
  // onBeforeNavigate: the navigation in this frame starts at this URL
  readonly started: (event: FrameUrl) => Promise<void>;
  // onCommitted: the blocked URL the navigation in this frame started at, its password masked,
  // if a redirect took it elsewhere. The start stays until the frame's next navigation starts or
  // the tab closes.
  readonly redirectedFrom: (event: FrameCommit) => Promise<string | undefined>;
  // tabs.onRemoved: the tab's frames will report nothing more
  readonly tabClosed: (tabId: number) => Promise<void>;
}

const KEY_PREFIX = "start:";

function key({ tabId, frameId }: FrameId): string {
  return `${KEY_PREFIX}${tabId}:${frameId}`;
}

// Remembers where each frame's navigation started, which the page itself can no longer tell
// once a Service Worker has redirected it (ADR-0004). The starts live in the store and not in
// memory: a Service Worker can hold the navigation until Chrome stops the extension's idle
// worker, and the redirect then lands in a new one (measured 2026-10-21).
export function createStartTracker(store: StartStore): StartTracker {
  return {
    // The settings are read when the navigation commits. The defaults block everything, so a
    // start counts if any settings could block it; other URLs are not kept. A new start
    // replaces the frame's earlier one either way, and nothing else clears it. Chrome can
    // report the earlier navigation's failure or commit after the new start, and both
    // navigations can land through a redirect when they start at the same URL (measured
    // 2026-10-20), so neither a failure nor a commit may take the start away. The password is
    // masked before it is kept, as the warning page shows it.
    started: (event) =>
      meetsBlockReason(event.url, DEFAULT_SETTINGS)
        ? store.set(key(event), maskPassword(event.url))
        : store.remove([key(event)]),
    // Without a redirect, the frame committed at the URL the navigation started at, which the
    // block rules and the content script already handle.
    redirectedFrom: async (event) => {
      const start = event.transitionQualifiers.includes("server_redirect")
        ? await store.get(key(event))
        : undefined;
      // started keeps only strings, so the check only narrows the type.
      return typeof start === "string" ? start : undefined;
    },
    tabClosed: async (tabId) => {
      const prefix = `${KEY_PREFIX}${tabId}:`;
      const keys = await store.keys();
      await store.remove(keys.filter((frame) => frame.startsWith(prefix)));
    },
  };
}
