import { meetsBlockReason } from "../blocking/block-reasons.ts";
import { maskPassword } from "../blocking/password-mask.ts";
import type { Settings } from "../settings/settings.ts";

// Where a page that a block rule missed (a Service Worker answered it) has to go instead,
// or null when it may stay (ADR-0004). The password is masked, as the block rules do.
export function warningTarget(
  href: string,
  settings: Settings,
  warningPageUrl: string,
): string | null {
  return meetsBlockReason(href, settings) ? `${warningPageUrl}#${maskPassword(href)}` : null;
}
