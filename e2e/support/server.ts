// A local HTTP server that plays both an ordinary ASCII site and an IDN site. Chromium is
// started with --host-resolver-rules so that both host names resolve to it.
import { createServer, type Server, type ServerResponse } from "node:http";

// аррӏө.com: five Cyrillic letters that Chrome 154 still showed as "apple.com"
export const IDN_HOST = "xn--80a6aa68c8d.com";
export const IDN_UNICODE_HOST = "аррӏө.com";
export const ASCII_HOST = "ascii.test";
export const IDN_CONTENT = "IDN CONTENT REACHED";

export interface TestServer {
  readonly port: number;
  /** Paths requested on the IDN host; any entry means a request got past the block. */
  readonly idnRequests: readonly string[];
  idnUrl: (path: string) => string;
  asciiUrl: (path: string) => string;
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
    "/sandboxed-iframe": (response) => {
      html(response, `<p id="outer">outer</p><iframe sandbox src="${idnUrl("/framed")}"></iframe>`);
    },
  };
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
  let port = 0;
  const idnUrl = (path: string): string => `http://${IDN_HOST}:${port}${path}`;
  const asciiUrl = (path: string): string => `http://${ASCII_HOST}:${port}${path}`;
  const routes = asciiRoutes(idnUrl);

  const server = createServer((request, response) => {
    const host = (request.headers.host ?? "").replace(/:\d+$/u, "");
    const path = request.url ?? "/";
    if (host === IDN_HOST) {
      idnRequests.push(path);
      html(response, `<h1>${IDN_CONTENT}</h1>`);
      return;
    }
    const route = routes[new URL(path, asciiUrl("/")).pathname];
    if (route === undefined) {
      html(response, `<h1>ASCII PAGE</h1>`);
    } else {
      route(response);
    }
  });
  port = await listen(server);

  return { port, idnRequests, idnUrl, asciiUrl, close: () => close(server) };
}
