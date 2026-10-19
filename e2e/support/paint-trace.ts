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
  readonly frame: string | undefined;
  readonly url: string | undefined;
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
// for CommitLoad and Paint (Chromium's trace events, as seen in Phase 0's traces).
function traceEvent(raw: unknown): TraceEvent {
  const event = record(raw);
  const args = record(event["args"]);
  const data = record(args["data"]);
  return {
    name: String(event["name"]),
    ts: Number(event["ts"]),
    frame: optionalString(args["frame"]) ?? optionalString(data["frame"]),
    url: optionalString(data["url"]),
  };
}

// The attacker's document is the one whose URL carries the visit's ID in its query. The warning
// page carries it in its fragment and the embedding page not at all (server.iframeEmbeddingUrl),
// so neither counts: Phase 0 found that an ID in the embedding page's URL made its paints count.
function isAttackerDocument(url: string, visit: AttackerVisit): boolean {
  return new URL(url).searchParams.get(VISIT_PARAMETER) === visit.id;
}

/**
 * Counts the paint events in each frame between the commit of an attacker document and the next
 * commit in that frame (or the end of the trace).
 */
function countAttackerPaints(events: readonly TraceEvent[], visit: AttackerVisit): AttackerPaints {
  const commits = events.filter((event) => event.name === "CommitLoad");
  // CommitLoad always carries a URL; the undefined check only narrows the type. Math.min() of
  // nothing is Infinity: with no later commit, the window stays open to the end.
  const windows = commits
    .filter((commit) => commit.url !== undefined && isAttackerDocument(commit.url, visit))
    .map((commit) => ({
      frame: commit.frame,
      start: commit.ts,
      end: Math.min(
        ...commits
          .filter((next) => next.frame === commit.frame && next.ts > commit.ts)
          .map((next) => next.ts),
      ),
    }));
  const count = (name: string): number =>
    events.filter(
      (event) =>
        event.name === name &&
        windows.some(
          (window) =>
            window.frame === event.frame && event.ts >= window.start && event.ts < window.end,
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
