import { findBlockReasons } from "../blocking/block-reasons.ts";
import { BLOCKED_PROTOCOLS, maskPassword } from "../blocking/password-mask.ts";
import type { Settings } from "../settings/settings.ts";

// Whether the settings block this URL, like the block rules do: only http and https URLs.
// href is document.URL or a webNavigation URL, both already parsed by Chrome, so it always
// parses. The content script only sees http and https pages, but webNavigation also reports
// file:, data:, about: and chrome-extension: URLs, and a file: URL can have an IP or IDN host.
export function meetsBlockReason(href: string, settings: Settings): boolean {
  const url = new URL(href);
  return BLOCKED_PROTOCOLS.has(url.protocol) && findBlockReasons(url, settings).length > 0;
}

// Where a page that a block rule missed (a Service Worker answered it) has to go instead,
// or null when it may stay (ADR-0004). The password is masked, as the block rules do.
export function warningTarget(
  href: string,
  settings: Settings,
  warningPageUrl: string,
): string | null {
  return meetsBlockReason(href, settings) ? `${warningPageUrl}#${maskPassword(href)}` : null;
}
