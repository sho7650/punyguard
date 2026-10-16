// The block rule only redirects http and https URLs, so anything else in the fragment
// was put there by someone opening the warning page directly.
const BLOCKED_PROTOCOLS: ReadonlySet<string> = new Set(["http:", "https:"]);

// Reads the original URL from the warning page's fragment. Any page can open the warning
// page with a fragment of its choice, so the content is untrusted.
export function parseBlockedUrl(hash: string): URL | null {
  const url = URL.parse(hash.slice(1));
  return url !== null && BLOCKED_PROTOCOLS.has(url.protocol) ? url : null;
}

// The warning page shows the original URL on screen, where a password in it could be read over
// a shoulder or end up in a screenshot. The user name stays: an xn-- there is what got the URL
// blocked (the known false positive in README.md).
export function hidePassword(href: string): string {
  const shown = new URL(href);
  shown.password = "";
  return shown.href;
}
