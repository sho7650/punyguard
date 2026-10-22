import { BLOCKED_PROTOCOLS } from "../blocking/password-mask.ts";

// Reads the original URL from the warning page's fragment. Any page can open the warning
// page with a fragment of its choice, so the content is untrusted: the block rules only put
// http and https URLs there, so anything else was put there by someone opening the warning
// page directly.
export function parseBlockedUrl(hash: string): URL | null {
  const url = URL.parse(hash.slice(1));
  return url !== null && BLOCKED_PROTOCOLS.has(url.protocol) ? url : null;
}
