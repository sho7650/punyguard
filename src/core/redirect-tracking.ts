import { DEFAULT_SETTINGS, type Settings } from "./settings.ts";
import { meetsBlockReason, warningTarget } from "./warning-target.ts";

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

export interface StartTracker {
  // onBeforeNavigate: the navigation in this frame starts at this URL
  readonly started: (event: FrameUrl) => void;
  // onCommitted: the blocked URL the navigation in this frame started at, if a redirect took it
  // elsewhere. The start stays until the frame's next navigation starts or the tab closes.
  readonly redirectedFrom: (event: FrameCommit) => string | undefined;
  // tabs.onRemoved: the tab's frames will report nothing more
  readonly tabClosed: (tabId: number) => void;
}

function key({ tabId, frameId }: FrameId): string {
  return `${tabId}:${frameId}`;
}

// Remembers where each frame's navigation started, which the page itself can no longer tell
// once a Service Worker has redirected it (ADR-0004).
export function createStartTracker(): StartTracker {
  let starts: ReadonlyMap<string, string> = new Map();
  return {
    started: (event) => {
      // The settings are read when the navigation commits. The defaults block everything, so
      // a start counts if any settings could block it; other URLs are not kept. A new start
      // replaces the frame's earlier one either way, and nothing else clears it. Chrome can
      // report the earlier navigation's failure or commit after the new start, and both
      // navigations can land through a redirect when they start at the same URL (measured
      // 2026-10-20), so neither a failure nor a commit may take the start away.
      const rest = new Map(starts);
      rest.delete(key(event));
      starts = meetsBlockReason(event.url, DEFAULT_SETTINGS)
        ? rest.set(key(event), event.url)
        : rest;
    },
    // Without a redirect, the frame committed at the URL the navigation started at, which the
    // block rules and the content script already handle.
    redirectedFrom: (event) =>
      event.transitionQualifiers.includes("server_redirect") ? starts.get(key(event)) : undefined,
    tabClosed: (tabId) => {
      const prefix = `${tabId}:`;
      starts = new Map(
        [...starts].filter(([frame]: readonly [string, string]) => !frame.startsWith(prefix)),
      );
    },
  };
}
