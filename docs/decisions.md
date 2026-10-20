# Design decisions

A record of what this project decided and why. When a decision changes, update its entry and note the reason for the change.

The decisions that came with the template are in [template-decisions.md](template-decisions.md). That file is replaced by `nix run .#update`, so record this project's decisions here.

## P1. E2E code turns off `prefer-readonly-parameter-types`

- **Decision**: `.oxlintrc.json` turns off `typescript/prefer-readonly-parameter-types` for `e2e/**/*.ts` only.
- **Why**: Playwright hands every test and fixture mutable objects (`Page`, `BrowserContext`, `ServerResponse`, the fixture object itself), so the rule fires on nearly every function in `e2e/` and the only fix would be a disable comment on each one. `src/` keeps the rule.

## P2. oxfmt skips the files release-please writes

- **Decision**: `.oxfmtrc.json` ignores `CHANGELOG.md`, `.release-please-manifest.json` and `manifest.json`.
- **Why**: release-please rewrites them in its own format: the manifest file compact, and `manifest.json` (through `extra-files`) with `JSON.stringify`, which puts every array item on its own line. oxfmt collapses short arrays, so the two can never agree and the Release PR fails `format:check`. `package.json` is unaffected: release-please's node updater keeps its layout.

## P3. Navigation that a service worker answers is blocked by a content script

- **Decision**: Block it with a content script that runs at `document_start` in every frame and moves a blocked page to the warning page, and follow service worker redirects with `webNavigation` ([ADR-0004](adr/0004-content-script-blocks-service-worker-navigation.md)). Changed on 2026-10-20: this entry first accepted that such navigation stays unblocked, but the user info case could be reached after a single visit to the attacker's site.
- **Why**: Chrome's documentation says declarativeNetRequest applies only to requests that reach the network stack, and not to responses a service worker generates or takes from `CacheStorage` ([declarativeNetRequest](https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest)). Checked on Chromium on 2026-10-18: with a service worker registered on an IDN host and the rules then put back, neither a response the worker built itself nor one it relayed with `fetch(event.request)` was blocked, and the relayed one reached the server. The worker's `fetch()` is not a `main_frame` request, so the rules do not match it. A path the worker did not answer was blocked. The same holds for a URL with user info: after one plain visit to an ASCII host registered a worker, `http://paypal.com@<host>/` was answered by the worker and not blocked (a relayed `fetch()` failed there, because the URL carries credentials).
- **Reach without the content script**: A service worker can only be registered by a page of its origin.
  - IDN hosts: with PunyGuard installed, their pages never load, so only hosts visited before PunyGuard was installed (or while its rules were missing) are exposed.
  - IP address hosts: likewise, only hosts visited while that block was off or private IP addresses were excluded.
  - URLs with user info: the block is on the URL, not the host, and the host's own pages load normally. An attacker who gets the user to visit their site once can register a worker there and later have `https://paypal.com@evil.example/` answered by it, with PunyGuard installed. This is the case that matters.
- **Limits**: These remain, and are listed under "Known limitations" in the README and in section 6 of [the requirements](../tasks/requirements-service-worker-bypass.md):
  - The service worker's own code runs when it answers the navigation.
  - A page that the service worker redirects to may show and run before it is replaced.
  - A relayed navigation to a URL with user info ends on Chrome's error page, with the URL left in the address bar and the tab's back history.
  - Right after an update or reload, navigations answered by a service worker are not blocked until the content script is registered again (70–83 ms in the measurements).
- **Rejected**: See the considered options in ADR-0004.

## P4. `blocked.html` stays at a fixed URL

- **Decision**: `web_accessible_resources` in `manifest.json` keeps `use_dynamic_url: false`.
- **Why**: With a fixed URL, any page can tell that PunyGuard is installed by trying to load `chrome-extension://<ID>/blocked.html`. An attacker who learns that can only switch to a trick without `xn--` labels, user info or IP address hosts, and such tricks were outside what PunyGuard guards against to begin with. Knowing it is installed does not weaken the protection.
