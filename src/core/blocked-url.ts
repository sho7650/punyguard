// The block rule only redirects http and https URLs, so anything else in the fragment
// was put there by someone opening the warning page directly.
const BLOCKED_PROTOCOLS: ReadonlySet<string> = new Set(["http:", "https:"]);

// Reads the original URL from the warning page's fragment. Any page can open the warning
// page with a fragment of its choice, so the content is untrusted.
export function parseBlockedUrl(hash: string): URL | null {
  const url = URL.parse(hash.slice(1));
  return url !== null && BLOCKED_PROTOCOLS.has(url.protocol) ? url : null;
}

export const MASKED_PASSWORD = "***";

// The block rules mask the password before the redirect (block-rule.ts), but anyone can open
// the warning page with a password in the fragment, so the page masks it again before showing
// it. The masked password stays, so the URL still has the userinfo it was blocked for. The user
// name stays too: in a URL with user info it is the part dressed up as the destination, which
// the warning page points out.
export function maskPassword(href: string): string {
  const shown = new URL(href);
  if (shown.password !== "") {
    shown.password = MASKED_PASSWORD;
  }
  return shown.href;
}
