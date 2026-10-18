// A local HTTP server that plays both an ordinary ASCII site and an IDN site. Chromium is
// started with --host-resolver-rules so that both host names resolve to it.
import { createServer, type Server, type ServerResponse } from "node:http";

// аррӏө.com: five Cyrillic letters that Chrome 154 still showed as "apple.com"
export const IDN_HOST = "xn--80a6aa68c8d.com";
export const IDN_UNICODE_HOST = "аррӏө.com";
export const ASCII_HOST = "ascii.test";
export const IDN_CONTENT = "IDN CONTENT REACHED";
// A documentation address (RFC 5737). Blocking redirects before any connection, so nothing
// needs to answer there; a test that expects it to load would hang instead.
export const PUBLIC_IP_URL = "http://203.0.113.5/login";
export const EMBEDDED_CONTENT = "EMBEDDED CONTENT REACHED";
// The path that the embedded documents on the IP address host and the URL with user info load.
// The user info never reaches the server, so the path is what tells these requests apart.
export const EMBEDDED_PATH = "/embedded";

/** Where an embedding page points its embedded document. */
// "userinfo" is on the ASCII host and "localhostUserinfo" on localhost, so the two share their
// user info but not their origin.
export type EmbedTarget = "idn" | "ip" | "userinfo" | "localhostUserinfo" | "ascii";
/** The element that embeds the document. */
export type EmbedElement = "iframe" | "object" | "embed";

export interface TestServer {
  readonly port: number;
  /** Paths requested on the IDN host; any entry means a request got past the block. */
  readonly idnRequests: readonly string[];
  /** Requests for EMBEDDED_PATH on any other host; any entry means an embedded document loaded. */
  readonly embeddedRequests: readonly string[];
  idnUrl: (path: string) => string;
  asciiUrl: (path: string) => string;
  /** The page that embeds the target's document with the element. */
  embeddingUrl: (target: EmbedTarget, element: EmbedElement) => string;
  close: () => Promise<void>;
}

type Route = (response: ServerResponse) => void;

function html(response: ServerResponse, body: string): void {
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(`<!doctype html><meta charset="utf-8"><body>${body}</body>`);
}

// Pages on the ASCII host that lead to the IDN host in different ways.
function asciiRoutes(idnUrl: (path: string) => string): Readonly<Record<string, Route>> {
  return {
    "/link": (response) => {
      html(response, `<a id="idn-link" href="${idnUrl("/clicked")}">link</a>`);
    },
    // A new tab whose first page is the IDN URL, as when a link opens in a new tab
    "/new-tab-link": (response) => {
      html(
        response,
        `<a id="idn-link" href="${idnUrl("/new-tab")}" target="_blank" rel="noopener">link</a>`,
      );
    },
    "/redirect": (response) => {
      response.writeHead(302, { location: idnUrl("/redirected") });
      response.end();
    },
    "/iframe": (response) => {
      html(response, `<p id="outer">outer</p><iframe src="${idnUrl("/framed")}"></iframe>`);
    },
    "/ip-iframe": (response) => {
      html(response, `<p id="outer">outer</p><iframe src="${PUBLIC_IP_URL}"></iframe>`);
    },
    "/sandboxed-iframe": (response) => {
      html(response, `<p id="outer">outer</p><iframe sandbox src="${idnUrl("/framed")}"></iframe>`);
    },
  };
}

const EMBED_MARKUP: Readonly<Record<EmbedElement, (url: string) => string>> = {
  iframe: (url) => `<iframe src="${url}"></iframe>`,
  object: (url) => `<object data="${url}"></object>`,
  embed: (url) => `<embed src="${url}">`,
};

function embeddingPath(target: EmbedTarget, element: EmbedElement): string {
  return `/embedding/${target}/${element}`;
}

// Pages on the ASCII host that embed a document from each target with each element.
function embeddingRoutes(
  targetUrl: (target: EmbedTarget) => string,
): Readonly<Record<string, Route>> {
  const targets: readonly EmbedTarget[] = ["idn", "ip", "userinfo", "localhostUserinfo", "ascii"];
  const elements: readonly EmbedElement[] = ["iframe", "object", "embed"];
  return Object.fromEntries(
    targets.flatMap((target) =>
      elements.map((element): [string, Route] => [
        embeddingPath(target, element),
        (response) => {
          html(response, `<p id="outer">outer</p>${EMBED_MARKUP[element](targetUrl(target))}`);
        },
      ]),
    ),
  );
}

function embeddedUrl(target: EmbedTarget, port: number): string {
  const authorities: Readonly<Record<EmbedTarget, string>> = {
    idn: IDN_HOST,
    ip: "127.0.0.1",
    userinfo: `user@${ASCII_HOST}`,
    localhostUserinfo: "user@localhost",
    ascii: ASCII_HOST,
  };
  return `http://${authorities[target]}:${port}${EMBEDDED_PATH}`;
}

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new TypeError(`Expected a TCP address, got ${String(address)}`);
  }
  return address.port;
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    // The browser may still hold keep-alive connections, which close() would wait for.
    server.closeAllConnections();
    server.close((error) => {
      if (error === undefined) {
        resolve();
      } else {
        reject(error);
      }
    });
  });
}

export async function startServer(): Promise<TestServer> {
  const idnRequests: string[] = [];
  const embeddedRequests: string[] = [];
  let port = 0;
  const idnUrl = (path: string): string => `http://${IDN_HOST}:${port}${path}`;
  const asciiUrl = (path: string): string => `http://${ASCII_HOST}:${port}${path}`;
  const routes = {
    ...asciiRoutes(idnUrl),
    ...embeddingRoutes((target) => embeddedUrl(target, port)),
  };

  const server = createServer((request, response) => {
    const host = (request.headers.host ?? "").replace(/:\d+$/u, "");
    const path = request.url ?? "/";
    if (host === IDN_HOST) {
      idnRequests.push(path);
      html(response, `<h1>${IDN_CONTENT}</h1>`);
      return;
    }
    const pathname = new URL(path, asciiUrl("/")).pathname;
    if (pathname === EMBEDDED_PATH) {
      embeddedRequests.push(path);
      html(response, `<h1>${EMBEDDED_CONTENT}</h1>`);
      return;
    }
    const route = routes[pathname];
    if (route === undefined) {
      html(response, `<h1>ASCII PAGE</h1>`);
    } else {
      route(response);
    }
  });
  port = await listen(server);

  return {
    port,
    idnRequests,
    embeddedRequests,
    idnUrl,
    asciiUrl,
    embeddingUrl: (target, element) => asciiUrl(embeddingPath(target, element)),
    close: () => close(server),
  };
}
