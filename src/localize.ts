// Swaps the text of every [data-i18n] element for the message in the browser's language.
// The page shows the Japanese or the English catalog, so lang names the catalog in use,
// not the browser's UI language (which may be one with no catalog, such as French).
export function localize(): void {
  document.documentElement.lang = chrome.i18n.getMessage("lang");
  for (const element of document.querySelectorAll<HTMLElement>("[data-i18n]")) {
    const key = element.dataset["i18n"];
    if (key !== undefined) {
      element.textContent = chrome.i18n.getMessage(key);
    }
  }
}
