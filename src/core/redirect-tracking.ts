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

export interface StartTracker {
  // onBeforeNavigate: the navigation in this frame starts at this URL
  readonly started: (event: FrameUrl) => void;
  // onCommitted and onErrorOccurred: the URL the navigation in this frame started at, if it was
  // remembered. Each start is handed back once, so nothing piles up.
  readonly ended: (event: FrameId) => string | undefined;
}

function key({ tabId, frameId }: FrameId): string {
  return `${tabId}:${frameId}`;
}

// Remembers where each frame's navigation started, which the page itself can no longer tell
// once a Service Worker has redirected it (ADR-0004).
export function createStartTracker(): StartTracker {
  let starts: ReadonlyMap<string, string> = new Map();
  const forget = (frame: string): ReadonlyMap<string, string> => {
    const rest = new Map(starts);
    rest.delete(frame);
    return rest;
  };
  return {
    started: (event) => {
      // The settings are read when the navigation commits. The defaults block everything, so
      // a start counts if any settings could block it; other URLs are not kept. A new start
      // replaces the frame's earlier one either way: Chrome can report it before the earlier
      // navigation's failure, and the earlier start must not be taken for this navigation's.
      starts = meetsBlockReason(event.url, DEFAULT_SETTINGS)
        ? new Map(starts).set(key(event), event.url)
        : forget(key(event));
    },
    ended: (event) => {
      const start = starts.get(key(event));
      starts = forget(key(event));
      return start;
    },
  };
}
