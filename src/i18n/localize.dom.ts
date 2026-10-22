// Swaps the text of every [data-i18n] element for the message in the browser's language.
// The page shows the Japanese or the English catalog, so lang names the catalog in use,
// not the browser's UI language (which may be one with no catalog, such as French).
export function localize(): void {
  document.documentElement.lang = chrome.i18n.getMessage("lang");
  for (const element of document.querySelectorAll<HTMLElement>("[data-i18n]")) {
    // The ?? only satisfies the type: the [data-i18n] selector matched, so the attribute is there.
    element.textContent = chrome.i18n.getMessage(element.dataset["i18n"] ?? "");
  }
}
