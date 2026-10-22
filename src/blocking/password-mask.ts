// The block rules only redirect http and https URLs.
export const BLOCKED_PROTOCOLS: ReadonlySet<string> = new Set(["http:", "https:"]);

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
