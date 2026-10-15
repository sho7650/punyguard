// The block rule only redirects http and https URLs, so anything else in the fragment
// was put there by someone opening the warning page directly.
const BLOCKED_PROTOCOLS: ReadonlySet<string> = new Set(["http:", "https:"]);

// Reads the original URL from the warning page's fragment. Any page can open the warning
// page with a fragment of its choice, so the content is untrusted.
export function parseBlockedUrl(hash: string): URL | null {
  const url = URL.parse(hash.slice(1));
  return url !== null && BLOCKED_PROTOCOLS.has(url.protocol) ? url : null;
}
