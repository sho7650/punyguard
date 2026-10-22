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

## P5. Folders follow the concepts, and the coordinators sit at the top of `src/`

- **Decision**: Each concept of CONTEXT.md has its own folder: `blocking/` (the block reasons and the block rules), `settings/`, `warning-page/`, `service-worker-navigation/` (ADR-0004) and `i18n/`. `blocking/`, `settings/` and `i18n/` are shared: the other folders may use them. The files that connect the parts, `background.entry.ts` and `protection.ts`, stay at the top of `src/`. Tests sit next to what they test, and the fakes they share are in `test-support/`. Source files may be moved or renamed freely, but the output names in `dist/` stay (`blocked.html`, `content.js` and so on): the users' history and their block rules hold the warning page's URL. `scripts/build.ts` maps each source to its output name.
- **Why**: The code used to be split by technical part (`src/` for the entry points, `src/core/` for the rest), so reading one concept meant moving between folders; ADR-0004 alone was spread over five files. With a folder per concept, a reader can start from the folder named after the term in CONTEXT.md.
- **Kept apart**: The block rules (`block-rules.ts`) and the URL check (`block-reasons.ts`) decide the same thing in two technologies, a regex for Chrome and a parsed URL, and stay two modules side by side in `blocking/`. A table with one entry per block reason was tried and dropped: decisions that cross the reasons (the priorities, the password rules, how strong the allow rules are) ended up in three files, and only the IDN entry could be read on its own. `block-rules-agreement.test.ts` checks that the two agree.

## P6. File suffixes mark what touches the browser, and oxlint enforces the boundaries

- **Decision**: A file that touches the browser at run time says so in its name: `*.entry.ts` for entry points, `*.chrome.ts` for wrappers of Chrome's APIs and `*.dom.ts` for DOM code. Every other file is pure. Coverage leaves out the three suffixes, and the E2E tests cover those files. `.oxlintrc.json` enforces three rules:
  - R1: A pure file does not use `chrome`, `document` or `location` at run time (`no-restricted-globals` with `checkGlobalObject`, so `globalThis.chrome` counts too). `chrome.*` in a type position is allowed. It applies to tests and `test-support/` too.
  - R2: A folder does not import a sibling folder other than the shared ones (`no-restricted-imports`, one override per group of folders). The coordinators at the top of `src/`, tests and `test-support/` are exempt: a fake has to import the folder it stands in for, which says nothing about the production boundaries.
  - R3: Nothing imports an entry point. It is in the base `rules`, so it applies to every `.ts` file, `e2e/` and `scripts/` included.
- **Why**: Nothing else told a reader which files need a browser to run, and the boundaries between folders (P5) would drift without a check. dependency-cruiser does not support TypeScript 7.
- **Watch out**: When an override sets `no-restricted-imports`, its options replace those of the base rule instead of merging with them, and the same holds between two overrides that match the same file. So each R2 override repeats the R3 pattern. A new override that sets `no-restricted-imports` must do the same. The rules were checked on 2026-10-22 with trial files that break each of them.

## Future goals

- Make the words on the pages, the README and CONTEXT.md agree. They mix 「遮断」 with 「止める」 and 「遷移」 with 「移動」. This touches what users see, so it is left out of the 2026 restructuring (P5).
