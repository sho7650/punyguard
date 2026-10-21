// The attacker side of the test server (attacker-site.ts holds what it serves). server.ts puts
// these routes in front of its own on every host and adds the methods to TestServer.
import type { ServerResponse } from "node:http";
import {
  attackerPage,
  type Beacon,
  BEACON_PATH,
  type BlockReason,
  HOLD_PATH,
  isNetworkAttackerPath,
  NETWORK_ATTACKER_PATH,
  parseBeacon,
  REGISTRATION_PATH,
  scopePath,
  scriptKind,
  serviceWorkerScript,
  type ServiceWorkerKind,
  VISIT_PARAMETER,
} from "./attacker-site.ts";

/** One navigation to an attacker URL, told apart from the others by its ID. */
export interface AttackerVisit {
  readonly id: string;
  readonly url: string;
}

/**
 * The site whose page embeds an iframe: ASCII_HOST, where the seeding registered the iframes'
 * Service Workers, or 127.0.0.1 as a top-level site where it registered none. PunyGuard blocks
 * 127.0.0.1 as a page, so "ip" is for checks without it.
 */
export type EmbeddingSite = "ascii" | "ip";

/** Where the attacker routes live, from server.ts, which alone knows the hosts and the port. */
export interface AttackerUrls {
  /** The reason's origin, with the user info the attacker URLs carry or without it. */
  readonly reasonOrigin: (reason: BlockReason, withUserinfo: boolean) => string;
  readonly siteOrigin: (site: EmbeddingSite) => string;
}

export interface AttackerSite {
  /** Beacons from attacker pages, in the order they arrived. */
  readonly beacons: readonly Beacon[];
  /**
   * A new visit to a URL with the block reason, inside the scope of the Service Worker kind, or,
   * for "none", outside every scope so that only the network answers.
   */
  readonly attackerVisit: (reason: BlockReason, kind: ServiceWorkerKind | "none") => AttackerVisit;
  /**
   * A page on `site` (ASCII_HOST by default) whose only content besides #outer is an iframe of
   * the URL. The page's own URL does not contain the URL, so it never passes for the attacker's.
   */
  readonly iframeEmbeddingUrl: (url: string, site?: EmbeddingSite) => string;
  /** The page, on the reason's origin without user info, that the seeding registers from. */
  readonly registrationUrl: (reason: BlockReason) => string;
  /** The beacons that the visit's page sent. */
  readonly beaconsFor: (visit: AttackerVisit) => readonly Beacon[];
  /** Whether the visit's redirectAfterHold Service Worker is waiting on its hold. */
  readonly isHeld: (visit: AttackerVisit) => boolean;
  /** Answers the visit's hold, so that its Service Worker redirects. */
  readonly releaseHold: (visit: AttackerVisit) => void;
}

export interface AttackerRoutes {
  /** What TestServer offers the tests. */
  readonly site: AttackerSite;
  /** Answers the request and returns true if it is for an attacker route. */
  readonly respond: (url: URL, response: ServerResponse) => boolean;
}

const IFRAME_EMBEDDING_PATH = "/iframe-embedding/";

function send(response: ServerResponse, contentType: string, body: string): void {
  response.writeHead(200, { "content-type": contentType });
  response.end(body);
}

// The content type and body of the attacker route for the URL, or undefined if it is not one.
function routeBody(
  url: URL,
  urls: AttackerUrls,
  iframeSources: readonly string[],
): readonly [string, string] | undefined {
  const asciiOrigin = urls.siteOrigin("ascii");
  const kind = scriptKind(url.pathname);
  if (kind !== undefined) {
    const script = serviceWorkerScript(kind, {
      beaconUrl: `${asciiOrigin}${BEACON_PATH}`,
      plainHostAttackerUrl: `${asciiOrigin}${NETWORK_ATTACKER_PATH}`,
      holdUrl: `${asciiOrigin}${HOLD_PATH}`,
    });
    return ["text/javascript", script];
  }
  if (url.pathname === REGISTRATION_PATH) {
    return ["text/html; charset=utf-8", "<!doctype html><h1>REGISTRATION PAGE</h1>"];
  }
  if (isNetworkAttackerPath(url.pathname)) {
    return ["text/html; charset=utf-8", attackerPage("network", `${asciiOrigin}${BEACON_PATH}`)];
  }
  if (url.pathname.startsWith(IFRAME_EMBEDDING_PATH)) {
    // Only iframeEmbeddingUrl builds these paths, from an index it has just filled; ?? only
    // satisfies noUncheckedIndexedAccess.
    const source = iframeSources[Number(url.pathname.slice(IFRAME_EMBEDDING_PATH.length))] ?? "";
    const page = `<!doctype html><meta charset="utf-8"><body><p id="outer">outer</p><iframe src="${source}"></iframe></body>`;
    return ["text/html; charset=utf-8", page];
  }
  return undefined;
}

export function createAttackerRoutes(urls: AttackerUrls): AttackerRoutes {
  const beacons: Beacon[] = [];
  const iframeSources: string[] = [];
  // The open hold responses, by visit ID
  const holds = new Map<string, ServerResponse>();
  let visits = 0;
  const site: AttackerSite = {
    beacons,
    attackerVisit: (reason, kind) => {
      visits += 1;
      const id = `v${visits}`;
      const path = kind === "none" ? NETWORK_ATTACKER_PATH : `${scopePath(kind)}page`;
      return { id, url: `${urls.reasonOrigin(reason, true)}${path}?${VISIT_PARAMETER}=${id}` };
    },
    iframeEmbeddingUrl: (url, embeddingSite = "ascii") => {
      iframeSources.push(url);
      return `${urls.siteOrigin(embeddingSite)}${IFRAME_EMBEDDING_PATH}${iframeSources.length - 1}`;
    },
    registrationUrl: (reason) => `${urls.reasonOrigin(reason, false)}${REGISTRATION_PATH}`,
    beaconsFor: (visit) => beacons.filter((beacon) => beacon.visit === visit.id),
    isHeld: (visit) => holds.has(visit.id),
    releaseHold: (visit) => {
      holds.get(visit.id)?.writeHead(204).end();
      holds.delete(visit.id);
    },
  };
  const respond = (url: URL, response: ServerResponse): boolean => {
    if (url.pathname === BEACON_PATH) {
      beacons.push(parseBeacon(url.searchParams));
      response.writeHead(204);
      response.end();
      return true;
    }
    if (url.pathname === HOLD_PATH) {
      // Nothing is sent until releaseHold, so the Service Worker's fetch stays pending. Only
      // redirectAfterHold requests this path, always with the visit; ?? only narrows the type.
      holds.set(url.searchParams.get(VISIT_PARAMETER) ?? "", response);
      return true;
    }
    const body = routeBody(url, urls, iframeSources);
    if (body === undefined) {
      return false;
    }
    send(response, ...body);
    return true;
  };
  return { site, respond };
}
