// Fills in the warning page. The fragment is untrusted: any page can open blocked.html with
// a fragment of its choice, so everything from it is written with textContent and the
// original URL is never turned into a link.
import { parseBlockedUrl } from "./core/blocked-url.ts";
import { describeHost, type HostCharacter } from "./core/host-description.ts";

function requireElement<T extends HTMLElement>(id: string, type: new () => T): T {
  const element = document.querySelector(`#${id}`);
  if (!(element instanceof type)) {
    throw new TypeError(`blocked.html has no <${type.name}> with id "${id}"`);
  }
  return element;
}

function localize(): void {
  document.documentElement.lang = chrome.i18n.getUILanguage();
  for (const element of document.querySelectorAll<HTMLElement>("[data-i18n]")) {
    const key = element.dataset["i18n"];
    if (key !== undefined) {
      element.textContent = chrome.i18n.getMessage(key);
    }
  }
}

function scriptName(script: string): string {
  return chrome.i18n.getMessage(`script${script}`) || script;
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

function showDetails(href: string, hostname: string): void {
  const host = describeHost(hostname);
  requireElement("original-url", HTMLElement).textContent = href;
  requireElement("unicode-host", HTMLElement).textContent = host.unicode;
  requireElement("punycode-host", HTMLElement).textContent = host.punycode;
  requireElement("characters", HTMLTableSectionElement).replaceChildren(
    ...host.characters
      .filter((character) => !character.isAscii)
      .map((character) => characterRow(character)),
  );
  requireElement("details", HTMLElement).hidden = false;
}

async function closeThisTab(): Promise<void> {
  const tab = await chrome.tabs.getCurrent();
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

localize();
const blockedUrl = parseBlockedUrl(location.hash);
if (blockedUrl === null) {
  requireElement("unreadable", HTMLElement).hidden = false;
} else {
  showDetails(blockedUrl.href, blockedUrl.hostname);
}
showActions();
