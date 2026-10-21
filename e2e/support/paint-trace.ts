// Counts how often the attacker's page was painted, from a CDP trace, as Phase 0 did
// (tasks/todo-service-worker-bypass.md). A request for one of the page's images does not tell a
// paint from the browser fetching ahead (Phase 0), so requirements AC-1 is checked here.
import type { Page } from "@playwright/test";
import { VISIT_PARAMETER } from "./attacker-site.ts";
import type { AttackerVisit } from "./server.ts";

const CATEGORIES = [
  "devtools.timeline",
  "disabled-by-default-devtools.timeline",
  "loading",
  "blink.user_timing",
].join(",");

/** The fields of a trace event that the counting reads. */
interface TraceEvent {
  readonly name: string;
  readonly ts: number;
  /** The process that recorded the event. */
  readonly pid: number;
  readonly frame: string | undefined;
  readonly url: string | undefined;
  /** For FrameCommittedInBrowser: the renderer process the document committed in. */
  readonly processId: number | undefined;
}

export interface AttackerPaints {
  /** How many attacker documents committed; 0 means there was nothing to paint. */
  readonly committed: number;
  readonly firstPaint: number;
  readonly firstContentfulPaint: number;
  readonly paint: number;
  /**
   * firstContentfulPaint of any document, attacker or not. Above 0, it shows that the trace did
   * record paints, so zeros for the attacker are not an empty trace.
   */
  readonly anyDocumentFirstContentfulPaint: number;
}

export interface PaintTrace {
  /** Ends the trace and counts the visit's paints in it. */
  readonly stop: () => Promise<AttackerPaints>;
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a non-null object read only through unknown values
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

// The frame sits in args.frame for firstPaint and firstContentfulPaint, and in args.data.frame
// for CommitLoad, FrameCommittedInBrowser and Paint (Chromium's trace events, as seen in Phase 0's
// traces and in the traces dumped on 2026-10-21).
function traceEvent(raw: unknown): TraceEvent {
  const event = record(raw);
  const args = record(event["args"]);
  const data = record(args["data"]);
  return {
    name: String(event["name"]),
    ts: Number(event["ts"]),
    pid: Number(event["pid"]),
    frame: optionalString(args["frame"]) ?? optionalString(data["frame"]),
    url: optionalString(data["url"]),
    processId: typeof data["processId"] === "number" ? data["processId"] : undefined,
  };
}

// The attacker's document is the one whose URL carries the visit's ID in its query. The warning
// page carries it in its fragment and the embedding page not at all (server.iframeEmbeddingUrl),
// so neither counts: Phase 0 found that an ID in the embedding page's URL made its paints count.
function isAttackerDocument(url: string, visit: AttackerVisit): boolean {
  return new URL(url).searchParams.get(VISIT_PARAMETER) === visit.id;
}

/** Where one document's events can be in the trace. */
interface DocumentWindow {
  readonly frame: string | undefined;
  readonly pid: number | undefined;
  readonly url: string | undefined;
  readonly start: number;
  readonly end: number;
}

// The browser process records FrameCommittedInBrowser for every commit, with the renderer process
// it committed in. That renderer's own CommitLoad can be missing: a renderer started after
// Tracing.start can join the trace late and lose its first events. On 2026-10-21 (Linux, 4 CPUs,
// 2 workers, as in CI) 5 of 640 commits had no CommitLoad, while every commit had its
// FrameCommittedInBrowser, and the trace still reported no data loss. Without the CommitLoad the
// attacker document counted as not committed, or the warning page's paints counted as the
// attacker's. So the browser's commits bound each document, and only the events of the renderer
// it committed in count. A renderer loses a prefix of its events, so when its CommitLoad is
// missing so are its earlier events; when the CommitLoad is there, it starts the document, since
// the same renderer painted before it (67 times on 2026-10-21) for what the frame showed before.
// The CommitLoad also gives the document's URL: Chrome commits its error page for a refused
// relay under the attacker's URL in the browser (service-worker-top-level.spec.ts). If that
// CommitLoad is missing, the error page counts as an attacker document, and the test fails.
function documentWindows(events: readonly TraceEvent[]): readonly DocumentWindow[] {
  const commits = events.filter((event) => event.name === "FrameCommittedInBrowser");
  return commits.map((commit) => {
    // Math.min() of nothing is Infinity: with no later commit, the window stays open to the end.
    const end = Math.min(
      ...commits
        .filter((next) => next.frame === commit.frame && next.ts > commit.ts)
        .map((next) => next.ts),
    );
    const committedLoad = events.find(
      (event) =>
        event.name === "CommitLoad" &&
        event.pid === commit.processId &&
        event.frame === commit.frame &&
        event.ts >= commit.ts &&
        event.ts < end,
    );
    return {
      frame: commit.frame,
      pid: commit.processId,
      url: committedLoad?.url ?? commit.url,
      start: committedLoad?.ts ?? commit.ts,
      end,
    };
  });
}

/** Counts the paint events of each attacker document, in its frame and its renderer. */
function countAttackerPaints(events: readonly TraceEvent[], visit: AttackerVisit): AttackerPaints {
  const windows = documentWindows(events).filter(
    (window) => window.url !== undefined && isAttackerDocument(window.url, visit),
  );
  const count = (name: string): number =>
    events.filter(
      (event) =>
        event.name === name &&
        windows.some(
          (window) =>
            window.frame === event.frame &&
            window.pid === event.pid &&
            event.ts >= window.start &&
            event.ts < window.end,
        ),
    ).length;
  return {
    committed: windows.length,
    firstPaint: count("firstPaint"),
    firstContentfulPaint: count("firstContentfulPaint"),
    paint: count("Paint"),
    anyDocumentFirstContentfulPaint: events.filter((event) => event.name === "firstContentfulPaint")
      .length,
  };
}

/**
 * Starts tracing through a session on `page`; call it before the navigation. The trace covers
 * out-of-process iframes too: the iframe positive controls, whose iframes are cross-site, count
 * their paints (service-worker-controls.spec.ts).
 */
export async function startPaintTrace(page: Page, visit: AttackerVisit): Promise<PaintTrace> {
  const session = await page.context().newCDPSession(page);
  const events: TraceEvent[] = [];
  session.on("Tracing.dataCollected", ({ value }) => {
    events.push(...value.map((raw) => traceEvent(raw)));
  });
  await session.send("Tracing.start", { categories: CATEGORIES, transferMode: "ReportEvents" });
  return {
    stop: async () => {
      const complete = new Promise<void>((resolve) => {
        session.once("Tracing.tracingComplete", () => {
          resolve();
        });
      });
      await session.send("Tracing.end");
      await complete;
      await session.detach();
      return countAttackerPaints(events, visit);
    },
  };
}
