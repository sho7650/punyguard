// Fills in the warning page. The fragment is untrusted: any page can open blocked.html with
// a fragment of its choice, so everything from it is written with textContent and the
// original URL is never turned into a link.
import { findBlockReasons, type BlockReason } from "./core/block-reasons.ts";
import { maskPassword, parseBlockedUrl } from "./core/blocked-url.ts";
import { describeHost, type HostCharacter } from "./core/host-description.ts";
import { localize } from "./localize.ts";
import { loadSavedSettings } from "./settings-storage.ts";

function requireElement<T extends HTMLElement>(id: string, type: new () => T): T {
  const element = document.querySelector(`#${id}`);
  // Only narrows the type: blocked.html ships with this script, so a missing element is a
  // build mistake, not something that happens at run time.
  if (!(element instanceof type)) {
    throw new TypeError(`blocked.html has no <${type.name}> with id "${id}"`);
  }
  return element;
}

// Every name scriptOf returns has a script<Name> message, and src/locales.test.ts checks both
// catalogs for them, so the lookup never comes back empty.
function scriptName(script: string): string {
  return chrome.i18n.getMessage(`script${script}`);
}

function characterRow({ character, script, codePoint }: HostCharacter): HTMLTableRowElement {
  const row = document.createElement("tr");
  for (const text of [character, scriptName(script), codePoint]) {
    const cell = document.createElement("td");
    cell.textContent = text;
    row.append(cell);
  }
  return row;
}

function showIdnHost(hostname: string): void {
  const host = describeHost(hostname);
  requireElement("unicode-host", HTMLElement).textContent = host.unicode;
  requireElement("punycode-host", HTMLElement).textContent = host.punycode;
  requireElement("characters", HTMLTableSectionElement).replaceChildren(
    ...host.characters
      .filter((character) => !character.isAscii)
      .map((character) => characterRow(character)),
  );
}

// The parts of the blocked URL, with the password already masked.
interface BlockedUrlParts {
  readonly hostname: string;
  readonly host: string;
  readonly username: string;
  readonly password: string;
}

const REASON_FILLERS: Readonly<Record<BlockReason, (parts: BlockedUrlParts) => void>> = {
  idnHost: ({ hostname }) => {
    showIdnHost(hostname);
  },
  // The userinfo is what was dressed up as the destination; the host is where the link leads.
  userinfo: ({ username, password, host }) => {
    requireElement("userinfo", HTMLElement).textContent =
      password === "" ? username : `${username}:${password}`;
    requireElement("actual-host", HTMLElement).textContent = host;
  },
  ipHost: ({ hostname }) => {
    requireElement("ip-address", HTMLElement).textContent = hostname;
  },
};

// Shows a section for each reason that blocked the URL under the current settings. A URL that
// meets none (the page opened directly) shows the original URL alone.
async function showReasons(parts: BlockedUrlParts): Promise<void> {
  const reasons = findBlockReasons(parts, await loadSavedSettings());
  for (const reason of reasons) {
    REASON_FILLERS[reason](parts);
    requireElement(`reason-${reason}`, HTMLElement).hidden = false;
  }
}

async function closeThisTab(): Promise<void> {
  const tab = await chrome.tabs.getCurrent();
  // Only narrows the type: the buttons show only in a top-level window (showActions), which is
  // a tab, so the tab and its ID are always there.
  if (tab?.id !== undefined) {
    await chrome.tabs.remove(tab.id);
  }
}

// In an iframe the buttons would act on the parent's tab, so they stay hidden there.
function showActions(): void {
  if (window.top !== window) {
    return;
  }
  requireElement("close-tab", HTMLButtonElement).addEventListener("click", () => {
    closeThisTab().catch((error: unknown) => {
      console.error("Failed to close the tab", error);
    });
  });
  // history.length also counts entries ahead of this page, so the button can show up with
  // nothing behind it (a known limitation in tasks/todo.md). The browser has no way to ask
  // whether a cross-origin entry exists behind this one.
  const goBack = requireElement("go-back", HTMLButtonElement);
  goBack.hidden = history.length <= 1;
  goBack.addEventListener("click", () => {
    history.back();
  });
  requireElement("actions", HTMLElement).hidden = false;
}

// Chrome strips everything from the first ":~:" (a fragment directive) out of
// location.hash, which would cut short an original URL such as one with "#:~:text=".
// The navigation entry keeps the URL as it was navigated to.
function blockedFragment(): string {
  const url = navigation.currentEntry?.url ?? "";
  const start = url.indexOf("#");
  return start === -1 ? location.hash : url.slice(start);
}

function showBlockedUrl({ href }: Readonly<Pick<URL, "href">>): void {
  const shown = new URL(maskPassword(href));
  // The address bar shows this page's own URL, with the original URL in the fragment.
  // Only rewritten when a password had to be masked here, so ":~:" in other URLs is left alone.
  if (shown.href !== href) {
    history.replaceState(history.state, "", `#${shown.href}`);
  }
  requireElement("original-url", HTMLElement).textContent = shown.href;
  requireElement("details", HTMLElement).hidden = false;
  const { hostname, host, username, password } = shown;
  showReasons({ hostname, host, username, password }).catch((error: unknown) => {
    console.error("Failed to show why the page was blocked", error);
  });
}

localize();
const blockedUrl = parseBlockedUrl(blockedFragment());
if (blockedUrl === null) {
  requireElement("unreadable", HTMLElement).hidden = false;
} else {
  showBlockedUrl(blockedUrl);
}
showActions();
