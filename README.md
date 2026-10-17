# PunyGuard

[日本語](README.ja.md)

A Chrome extension (Manifest V3) that blocks navigation to URLs that disguise where they lead. It blocks three kinds: internationalized domain name (IDN) hosts, URLs with user info, and IP address hosts. Instead of the page, it shows a bundled warning page that explains what was blocked.

## Why

Chrome shows a domain in Punycode when it contains letters that look like others. The check relies on a list of confusable characters, and `ө` (U+04E9) was missing from it. So `аррӏө.com` (`xn--80a6aa68c8d.com`), five Cyrillic letters, was still shown in Unicode in Chrome 154 and looked exactly like `apple.com` ([article, in Japanese](https://www.gizmodo.jp/article/2610-chrome-phishing-domain-bypass/)).

Any check based on how similar letters look can miss a character like this. PunyGuard does not judge: it stops every IDN host. In the same spirit, it stops two other disguises by the form of the URL alone:

- **URLs with user info**: `https://www.apple.com@evil.example/` leads to `evil.example`. The part before `@` is only a user name.
- **IP address hosts**: a URL such as `http://203.0.113.5/login` does not tell you which site it is.

## What it blocks

| Blocked                                                             | Not blocked                                                              |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Hosts with any `xn--` label, including the top-level domain         | Non-ASCII characters in the path or query (`ja.wikipedia.org/wiki/東京`) |
| URLs with user info (`user@`, `user:pass@`)                         | Host names such as `localhost`                                           |
| IPv4 and IPv6 addresses as the host                                 | Images, scripts and other subresources                                   |
| Whole pages and iframes                                             |                                                                          |
| Clicks, typed addresses, redirects and links opened from other apps |                                                                          |

- **Legitimate IDNs are blocked too**, such as Japanese domains like `日本語.jp`. IDN blocking cannot be turned off, and there is no allowlist and no way to continue to the page ([ADR-0001](docs/adr/0001-block-all-idn-hosts.md)).
- Blocking URLs with user info and IP address hosts can be turned off in the [settings](#settings). By default, IP address host blocking also stops private IP addresses, such as a router's admin page or `127.0.0.1`; the settings can exclude them ([ADR-0003](docs/adr/0003-userinfo-and-ip-hosts-can-be-turned-off.md)).
- The warning page shows the original URL (as text, not a link, and with any password masked as `***`) and a section for each reason it was blocked:
  - IDN host: the host in Unicode and Punycode, and each non-ASCII character with its script and code point
  - URL with user info: the user name before `@`, and where the URL really leads
  - IP address host: the IP address
- It is in Japanese when Chrome's language is Japanese, and in English otherwise.

## Install

PunyGuard is distributed on GitHub only, not in the Chrome Web Store.

1. Download `punyguard-vX.Y.Z.zip` from [Releases](https://github.com/sho7650/punyguard/releases) and unzip it into a folder you will keep. Chrome loads the extension from that folder.
2. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and choose the folder.
3. Leave **Site access** at **On all sites** (see below).
4. To block in Incognito windows too, turn on **Allow in Incognito** (see below).

To update, replace the folder's contents with the new release and click the reload button on the extension's card.

To build from source instead, see [Development](#development) and load `dist/`.

## Settings

Click the PunyGuard icon in the toolbar to open the settings (or **Extension options** on the extension's details page in `chrome://extensions`). Changes are saved at once and apply from the next navigation.

| Setting                     | Default |
| --------------------------- | ------- |
| Block URLs with user info   | On      |
| Block IP address hosts      | On      |
| Except private IP addresses | Off     |

- Private IP addresses are those with no route on the internet: `0.0.0.0/8`, `10.0.0.0/8`, `100.64.0.0/10`, `127.0.0.0/8`, `169.254.0.0/16`, `172.16.0.0/12`, `192.168.0.0/16`, `::1`, `fc00::/7`, `fe80::/10`, and the IPv4-mapped IPv6 forms of those IPv4 ranges.
- Even when they are excluded, a URL with user info such as `http://admin@192.168.0.1/` is still blocked as a URL with user info.
- IDN host blocking has no setting.
- Each setting loosened from the default adds a line to the toolbar icon's tooltip (without the `!` badge).
- The settings are kept in `chrome.storage.local` on this device and are not synced. If the saved settings are broken, PunyGuard runs with the defaults (everything blocked).

## Permissions and privacy

| Permission              | Why                                                                                                                                                                                                                                                                               |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `declarativeNetRequest` | Registers the rules that match the URLs to block. Chrome applies the rules itself; the extension never sees your browsing                                                                                                                                                         |
| `<all_urls>`            | A rule that redirects (rather than just blocks) needs host access to the URLs it redirects. Redirecting is what lets the warning page explain why the page was stopped, instead of a bare `ERR_BLOCKED_BY_CLIENT` ([ADR-0002](docs/adr/0002-redirect-to-bundled-warning-page.md)) |
| `storage`               | Keeps the [settings](#settings) on this device                                                                                                                                                                                                                                    |

PunyGuard has no content scripts and sends nothing over the network. The only thing it stores is its settings.

### Keep site access at "On all sites"

If you limit **Site access** in `chrome://extensions` to **On click** or to specific sites, the redirect stops working and nothing is blocked any more. PunyGuard notices this and shows a `!` badge on its toolbar icon.

### Incognito windows

Chrome does not run extensions in Incognito windows unless you turn on **Allow in Incognito** on the extension's details page in `chrome://extensions`. Until then, **nothing is blocked in Incognito windows**, and the `!` badge does not tell you so.

Once allowed, blocking works there too, but **the warning page does not open in place of a whole page**: Chrome cannot show an extension's own pages in Incognito tabs, so you get Chrome's "is blocked" page with `ERR_BLOCKED_BY_CLIENT` instead. The original URL is still in the address bar, after `blocked.html#`. Any password in it is masked as `***` there too, before the redirect. A blocked iframe inside an Incognito page may still show the warning page within the frame.

As in normal windows, the warning page reads the original URL only to show it on screen; PunyGuard neither sends nor stores it.

### The `!` badge

A `!` on the toolbar icon means **blocking is off**. Hover over the icon to see why in the tooltip:

- **The blocking rule could not be registered**: reload the extension in `chrome://extensions`. If it persists, check the service worker's console there for the error.
- **Set site access to "On all sites"**: set it back to **On all sites**.

The badge goes away once both are fine.

Settings loosened from the default (blocking URLs with user info or IP address hosts turned off, private IP addresses excluded) are choices, not faults, so they add a line to the tooltip without the badge.

## Known limitations

- If the warning page is the first page of a new tab, and you go to another page and then come back with the browser's back button, **Go back** is shown but does nothing (there is no earlier page). **Close this tab** still works.

## Development

Node.js and pnpm come from the Nix flake. Requirements: [Nix](https://nixos.org/download/) with flakes, and [direnv](https://direnv.net/) (ideally with [nix-direnv](https://github.com/nix-community/nix-direnv)). Supported systems: `aarch64-darwin`, `aarch64-linux`, `x86_64-linux`.

```sh
direnv allow                            # loads Node.js and pnpm from flake.nix
pnpm install
pnpm run check                          # typecheck → lint → format:check → test:coverage
pnpm exec playwright install chromium   # once, before the first `pnpm run test:e2e`
pnpm run test:e2e
pnpm run build                          # the unpacked extension in dist/
```

Without direnv, prefix commands with `nix develop --command`.

| Script                   | What it does                                                                           |
| ------------------------ | -------------------------------------------------------------------------------------- |
| `pnpm run build`         | Build the unpacked extension into `dist/`                                              |
| `pnpm run build:watch`   | Rebuild `dist/` on every change                                                        |
| `pnpm run icons`         | Render `assets/icon.svg` into `icons/icon-{16,32,48,128}.png`                          |
| `pnpm run typecheck`     | Type-check `src/` and the Node.js side                                                 |
| `pnpm test`              | Run Vitest in watch mode                                                               |
| `pnpm run test:run`      | Run unit tests once                                                                    |
| `pnpm run test:coverage` | Run unit tests with coverage thresholds                                                |
| `pnpm run test:e2e`      | Build `dist/`, then run the Playwright E2E tests. The language tests run on Linux only |
| `pnpm run lint`          | Lint with oxlint (type-aware)                                                          |
| `pnpm run format`        | Format with oxfmt                                                                      |
| `pnpm run format:check`  | Check formatting                                                                       |
| `pnpm run check`         | typecheck → lint → format:check → test:coverage                                        |

The plan and its progress are in [tasks/todo.md](tasks/todo.md), the vocabulary in [CONTEXT.md](CONTEXT.md), and decisions in [docs/adr/](docs/adr/) and [docs/decisions.md](docs/decisions.md).

### Releases

Commits follow [Conventional Commits](https://www.conventionalcommits.org/). On every push to `main`, [release-please](https://github.com/googleapis/release-please) keeps a Release PR up to date. Merging it tags the version and creates the GitHub Release, with `version` in `package.json` and `manifest.json` bumped; the workflow then builds the tagged commit and attaches `punyguard-vX.Y.Z.zip` made from `dist/`. The release workflow pins its actions to commit SHAs and gives each job only the permissions it needs.

The workflow needs **Settings → Actions → General → Workflow permissions** set to **Read and write permissions**, with **Allow GitHub Actions to create and approve pull requests** turned on.

### Template

The project was generated from [copier-ts7](https://github.com/sho7650/copier-ts7) (TypeScript 7 `tsc`, Vitest 5, oxlint, oxfmt, Nix and direnv, pnpm 12). Update it with `nix run .#update` on a clean working tree. The template's decisions are in [docs/template-decisions.md](docs/template-decisions.md); do not edit that file or `docs/template-claude.md`, and do not run `nix flake update` (the template updates `flake.lock`).

Being a Chrome extension, this project changes the template in the places below. Keep them in mind when an update reports conflicts.

| File                                                | Change                                                                                                                                                                                                                                                                                                      |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tsconfig.json`                                     | Covers only `src/` (browser code): `module: "preserve"`, `moduleResolution: "bundler"`, `lib: ["esnext", "dom"]`, `types: ["chrome"]`                                                                                                                                                                       |
| `tsconfig.node.json`                                | New. The template's Node.js settings, for `scripts/`, `e2e/` and `*.config.ts`                                                                                                                                                                                                                              |
| `package.json`                                      | `typecheck` checks both tsconfigs. `build`, `build:watch`, `icons` and `test:e2e` added; `dev` removed. Adds `esbuild`, `@playwright/test`, `@types/chrome`, `@types/punycode` and `punycode`                                                                                                               |
| `pnpm-workspace.yaml`                               | New. Denies esbuild's build script (`allowBuilds`); its binary comes from optionalDependencies                                                                                                                                                                                                              |
| `scripts/build.ts`                                  | New. Bundles `src/background.ts`, `src/blocked.ts` and `src/options.ts` with esbuild and copies the manifest, HTML, CSS, icons, `_locales` and the license files (ours and each runtime dependency's, which are bundled) into `dist/`                                                                       |
| `scripts/icons.ts`, `assets/`, `icons/`             | New. The icon source and the PNGs rendered from it                                                                                                                                                                                                                                                          |
| `vitest.config.ts`                                  | Resolves packages with the same main fields as the esbuild browser bundle, so tests import the shipped file. Coverage excludes the entry points (`src/background.ts`, `src/blocked.ts`, `src/options.ts`) and the browser adapters (`src/localize.ts`, `src/settings-storage.ts`) instead of `src/index.ts` |
| `.oxlintrc.json`, `.gitignore`                      | Ignore `dist/`, `test-results/` and `playwright-report/`. `.oxlintrc.json` also turns off `prefer-readonly-parameter-types` in `e2e/` (docs/decisions.md P1)                                                                                                                                                |
| `.oxfmtrc.json`                                     | Also ignores `CHANGELOG.md`, `.release-please-manifest.json` and `manifest.json`, which release-please rewrites in its own format (docs/decisions.md P2)                                                                                                                                                    |
| `playwright.config.ts`, `e2e/`                      | New. E2E tests that load `dist/` into Chromium                                                                                                                                                                                                                                                              |
| `.github/workflows/ci.yml`                          | Adds the `e2e` job                                                                                                                                                                                                                                                                                          |
| `.github/workflows/release.yml`, `release-please-*` | New. release-please and the zip attached to each Release                                                                                                                                                                                                                                                    |
| `src/`                                              | The `greet` sample and `src/index.ts` are removed                                                                                                                                                                                                                                                           |

## License

[MIT](LICENSE)
