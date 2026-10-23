import { isIpAddressHost, isPrivateIpAddress } from "./ip-address.ts";
import type { Settings } from "../settings/settings.ts";

// The block rules only redirect http and https URLs.
export const BLOCKED_PROTOCOLS: ReadonlySet<string> = new Set(["http:", "https:"]);

// The grounds the warning page explains (CONTEXT.md "遮断理由"), in the order it shows them.
export type BlockReason = "idnHost" | "userinfo" | "ipHost";

function isIdnHost(hostname: string): boolean {
  return hostname.split(".").some((label) => label.startsWith("xn--"));
}

// The parts of a parsed URL the reasons depend on
type UrlParts = Readonly<Pick<URL, "hostname" | "username" | "password">>;

function hasUserinfo(url: UrlParts): boolean {
  return url.username !== "" || url.password !== "";
}

function isBlockedIpHost(hostname: string, settings: Settings): boolean {
  return (
    settings.blockIpHosts &&
    isIpAddressHost(hostname) &&
    !(settings.excludePrivateIps && isPrivateIpAddress(hostname))
  );
}

// Which reasons the URL meets, among those the settings leave on. The checks mirror the block
// rules, read from the parsed URL instead of from the URL string.
export function findBlockReasons(url: UrlParts, settings: Settings): readonly BlockReason[] {
  return [
    ...(isIdnHost(url.hostname) ? (["idnHost"] as const) : []),
    ...(settings.blockUserinfo && hasUserinfo(url) ? (["userinfo"] as const) : []),
    ...(isBlockedIpHost(url.hostname, settings) ? (["ipHost"] as const) : []),
  ];
}

// Whether the settings block this URL, like the block rules do: only http and https URLs.
// href is document.URL or a webNavigation URL, both already parsed by Chrome, so it always
// parses. The content script only sees http and https pages, but webNavigation also reports
// file:, data:, about: and chrome-extension: URLs, and a file: URL can have an IP or IDN host.
export function meetsBlockReason(href: string, settings: Settings): boolean {
  const url = new URL(href);
  return BLOCKED_PROTOCOLS.has(url.protocol) && findBlockReasons(url, settings).length > 0;
}
