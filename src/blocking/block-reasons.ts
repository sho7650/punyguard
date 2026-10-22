import { isIpAddressHost, isPrivateIpAddress } from "./ip-address.ts";
import type { Settings } from "../settings/settings.ts";

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
