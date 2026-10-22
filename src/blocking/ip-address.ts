// Patterns for IP address hosts as they appear in a URL Chrome has canonicalized: IPv4 always as
// four decimal parts (Chrome turns 3232235521 and 0xc0.168.0.1 into 192.168.0.1), and IPv6 in
// brackets as lowercase hex groups and colons, never with a dotted IPv4 tail
// ([::ffff:192.168.0.1] becomes [::ffff:c0a8:1]). They are RE2 for the block rules and are
// written to mean the same in JavaScript.
export const IPV4_PATTERN = String.raw`[0-9]{1,3}(?:\.[0-9]{1,3}){3}`;
export const IPV6_PATTERN = String.raw`\[[0-9a-f:]+\]`;

// RE2 limits how much memory a pattern compiles to, and counted repetitions such as
// [0-9]{1,3} cost the most (isRegexSupported: memoryLimitExceeded). Chrome canonicalizes the
// address, so after the prefix that decides the range, the rest needs no exact shape: IPv4 is
// always four decimal parts.
const REST = "[0-9.]+";

// Addresses with no route on the internet (CONTEXT.md "プライベート IP アドレス").
const PRIVATE_IPV4_RANGES = [
  // 0.0.0.0/8
  String.raw`0`,
  // 10.0.0.0/8
  String.raw`10`,
  // 100.64.0.0/10 (CGNAT)
  String.raw`100\.(?:6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])`,
  // 127.0.0.0/8
  String.raw`127`,
  // 169.254.0.0/16
  String.raw`169\.254`,
  // 172.16.0.0/12
  String.raw`172\.(?:1[6-9]|2[0-9]|3[01])`,
  // 192.168.0.0/16
  String.raw`192\.168`,
]
  .map((prefix) => String.raw`${prefix}\.${REST}`)
  .join("|");

// Grouped, so that the alternatives stay inside whatever pattern they are put in.
export const PRIVATE_IPV4_PATTERN = `(?:${PRIVATE_IPV4_RANGES})`;

// IPv6 counterparts: loopback, unique local (fc00::/7) and link-local (fe80::/10). Past the
// first group, a canonical address needs no exact shape either.
const PRIVATE_IPV6_GROUPS = [
  "::1",
  "f[cd][0-9a-f][0-9a-f]:[0-9a-f:]*",
  "fe[89ab][0-9a-f]:[0-9a-f:]*",
].join("|");

export const PRIVATE_IPV6_PATTERN = String.raw`\[(?:${PRIVATE_IPV6_GROUPS})\]`;

// The private IPv4 ranges inside an IPv4-mapped IPv6 address, where the first two octets are one
// hex group without leading zeros (10.0.0.1 is ::ffff:a00:1).
const PRIVATE_MAPPED_IPV4_GROUP = [
  // 0.0.0.0/8: 0 to ff
  "[0-9a-f][0-9a-f]?",
  // 10.0.0.0/8: a00 to aff
  "a[0-9a-f][0-9a-f]",
  // 100.64.0.0/10: 6440 to 647f
  "64[4-7][0-9a-f]",
  // 127.0.0.0/8
  "7f[0-9a-f][0-9a-f]",
  // 169.254.0.0/16
  "a9fe",
  // 172.16.0.0/12: ac10 to ac1f
  "ac1[0-9a-f]",
  // 192.168.0.0/16
  "c0a8",
].join("|");

export const PRIVATE_MAPPED_IPV4_PATTERN = String.raw`\[::ffff:(?:${PRIVATE_MAPPED_IPV4_GROUP}):[0-9a-f]+\]`;

const PRIVATE_IP_PATTERN = `(?:${PRIVATE_IPV4_PATTERN}|${PRIVATE_IPV6_PATTERN}|${PRIVATE_MAPPED_IPV4_PATTERN})`;

// URL.hostname is canonicalized the same way as the URL the block rules see, with IPv6 in
// brackets, so the rules' patterns apply to it unchanged.
const IP_HOST = new RegExp(String.raw`^(?:${IPV4_PATTERN}|${IPV6_PATTERN})$`, "u");

export function isIpAddressHost(hostname: string): boolean {
  return IP_HOST.test(hostname);
}

const PRIVATE_IP_HOST = new RegExp(`^${PRIVATE_IP_PATTERN}$`, "u");

export function isPrivateIpAddress(hostname: string): boolean {
  return PRIVATE_IP_HOST.test(hostname);
}
