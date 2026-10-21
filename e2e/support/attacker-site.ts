// The attacker's side of the Service Worker tests: the Service Workers, the pages they answer
// navigations with, and the pages that register them. server.ts serves these on every host, so
// one origin per block reason holds a Service Worker of each kind, each under its own scope.

/** The block reason a blocked URL has; one host per reason (server.ts). */
export type BlockReason = "idn" | "ip" | "userinfo";

/**
 * How the Service Worker answers a navigation in its scope:
 * - relay: fetches the same request from the network, which serves the attacker page
 * - synthetic: builds the attacker page itself
 * - redirectSameOrigin: redirects to a page on its own origin (without user info), which it
 *   builds itself
 * - redirectPlainHost: redirects to the attacker page on ASCII_HOST, served by the network
 * - redirectAfterHold: redirects as redirectPlainHost does, but only once the test server lets
 *   the visit's hold go (AttackerSite.releaseHold), so that a test can stop the extension's
 *   worker in between
 */
export type ServiceWorkerKind =
  | "relay"
  | "synthetic"
  | "redirectSameOrigin"
  | "redirectPlainHost"
  | "redirectAfterHold";

export const SERVICE_WORKER_KINDS: readonly ServiceWorkerKind[] = [
  "relay",
  "synthetic",
  "redirectSameOrigin",
  "redirectPlainHost",
  "redirectAfterHold",
];

export const ATTACKER_CONTENT = "ATTACKER CONTENT REACHED";

// A page on each origin, outside every Service Worker's scope, that the seeding opens to
// register them.
export const REGISTRATION_PATH = "/sw/register";
// Outside every Service Worker's scope, so only the network answers it.
export const NETWORK_ATTACKER_PATH = "/attacker";
export const BEACON_PATH = "/beacon";
// Answered only when the test lets the visit's hold go.
export const HOLD_PATH = "/hold";
// The query parameter that carries the visit's ID to the attacker page and on to its beacon.
export const VISIT_PARAMETER = "visit";

/** Who built the attacker page whose script sent a beacon. */
export type ServedBy = "network" | "serviceWorker";

export interface Beacon {
  /** The ID of the visit (AttackerVisit) whose page sent it. */
  readonly visit: string;
  readonly servedBy: ServedBy;
  /** Whether a Service Worker controlled the page; a relayed page comes from the network too. */
  readonly controlled: boolean;
}

// Where redirectSameOrigin's redirect lands, inside its own scope, so it builds that page too.
const SAME_ORIGIN_LANDING = "landing";

export function scopePath(kind: ServiceWorkerKind): string {
  return `/sw/${kind}/`;
}

export function scriptPath(kind: ServiceWorkerKind): string {
  return `${scopePath(kind)}sw.js`;
}

// Visible content before the script, so a paint has something to draw, and a script that
// reports itself. The visit's ID comes from the page's own URL, so the Service Worker can build
// the same page for every visit.
export function attackerPage(servedBy: ServedBy, beaconUrl: string): string {
  const visit = `encodeURIComponent(new URLSearchParams(location.search).get("${VISIT_PARAMETER}"))`;
  const controlled = "(navigator.serviceWorker.controller !== null)";
  const beacon = `${beaconUrl}?${VISIT_PARAMETER}=" + ${visit} + "&servedBy=${servedBy}&controlled=" + ${controlled} + "`;
  return `<!doctype html><meta charset="utf-8"><body style="background:#f00"><h1>${ATTACKER_CONTENT}</h1><script>navigator.sendBeacon("${beacon}");</script></body>`;
}

/** Where the Service Workers send what they need from the test server. */
export interface ServiceWorkerTargets {
  readonly beaconUrl: string;
  readonly plainHostAttackerUrl: string;
  readonly holdUrl: string;
}

// The response each kind builds, as JavaScript inside the fetch handler, where `url` is the
// navigation's URL.
function respondExpression(
  kind: ServiceWorkerKind,
  { beaconUrl, plainHostAttackerUrl, holdUrl }: ServiceWorkerTargets,
): string {
  const synthetic = `new Response(${JSON.stringify(attackerPage("serviceWorker", beaconUrl))}, { headers: { "content-type": "text/html" } })`;
  const expressions: Readonly<Record<ServiceWorkerKind, string>> = {
    relay: "fetch(event.request)",
    synthetic,
    // url.origin drops the user info, so a URL with user info lands on a plain URL.
    redirectSameOrigin: `url.pathname === "${scopePath(kind)}${SAME_ORIGIN_LANDING}" ? ${synthetic} : Response.redirect(url.origin + "${scopePath(kind)}${SAME_ORIGIN_LANDING}" + url.search, 302)`,
    redirectPlainHost: `Response.redirect(${JSON.stringify(plainHostAttackerUrl)} + url.search, 302)`,
    // no-cors: the hold is on another origin and sends no CORS headers.
    redirectAfterHold: `fetch(${JSON.stringify(holdUrl)} + url.search, { mode: "no-cors" }).then(() => Response.redirect(${JSON.stringify(plainHostAttackerUrl)} + url.search, 302))`,
  };
  return expressions[kind];
}

// Answers navigations only, so the attacker page's beacon goes to the network and reaches the
// test server whatever the kind.
export function serviceWorkerScript(
  kind: ServiceWorkerKind,
  targets: ServiceWorkerTargets,
): string {
  return `self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;
  const url = new URL(event.request.url);
  event.respondWith(${respondExpression(kind, targets)});
});`;
}

/** The kind whose script this path is, if it is one. */
export function scriptKind(pathname: string): ServiceWorkerKind | undefined {
  return SERVICE_WORKER_KINDS.find((kind) => pathname === scriptPath(kind));
}

// What the network answers inside a scope: the relay fetches these, and where no Service Worker
// is registered (another partition, as in the partitioning control) the network answers every
// kind's paths the same way.
export function isNetworkAttackerPath(pathname: string): boolean {
  return (
    pathname === NETWORK_ATTACKER_PATH ||
    SERVICE_WORKER_KINDS.some((kind) => pathname.startsWith(scopePath(kind)))
  );
}

/** The beacon a request for BEACON_PATH carries, read from its query. */
export function parseBeacon(query: URLSearchParams): Beacon {
  const servedBy = query.get("servedBy");
  // Only attackerPage builds these URLs, and it always sets both parameters; the check and ?? ""
  // only narrow the types.
  if (servedBy !== "network" && servedBy !== "serviceWorker") {
    throw new Error(`Unexpected beacon: ${query.toString()}`);
  }
  return {
    visit: query.get(VISIT_PARAMETER) ?? "",
    servedBy,
    controlled: query.get("controlled") === "true",
  };
}
