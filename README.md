# PunyGuard

[日本語](README.ja.md)

A Chrome extension (Manifest V3) that blocks every navigation to an internationalized domain name (IDN): any host with a label that starts with `xn--`. Instead of the page, it shows a bundled warning page that explains what was blocked.

## Why

Chrome shows a domain in Punycode when it contains letters that look like others. The check relies on a list of confusable characters, and `ө` (U+04E9) was missing from it. So `аррӏө.com` (`xn--80a6aa68c8d.com`), five Cyrillic letters, was still shown in Unicode in Chrome 154 and looked exactly like `apple.com` ([article, in Japanese](https://www.gizmodo.jp/article/2610-chrome-phishing-domain-bypass/)).

Any check based on how similar letters look can miss a character like this. PunyGuard does not judge: it stops every IDN host.

## What it blocks

| Blocked                                                             | Not blocked                                                              |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Hosts with any `xn--` label, including the top-level domain         | Non-ASCII characters in the path or query (`ja.wikipedia.org/wiki/東京`) |
| Whole pages and iframes                                             | Images, scripts and other subresources                                   |
| Clicks, typed addresses, redirects and links opened from other apps |                                                                          |

- **Legitimate IDNs are blocked too**, such as Japanese domains like `日本語.jp`. There is no allowlist and no way to continue to the page ([ADR-0001](docs/adr/0001-block-all-idn-hosts.md)).
- The warning page shows the original URL (as text, not a link), the host in Unicode and Punycode, and each non-ASCII character with its script and code point. It is in Japanese when Chrome's language is Japanese, and in English otherwise.
- Known false positive: a URL with `xn--` in its user info, such as `https://xn--a@example.com/`, is blocked.

## Install

PunyGuard is distributed on GitHub only, not in the Chrome Web Store.

1. Download `punyguard-vX.Y.Z.zip` from [Releases](https://github.com/sho7650/punyguard/releases) and unzip it into a folder you will keep. Chrome loads the extension from that folder.
2. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and choose the folder.
3. Leave **Site access** at **On all sites** (see below).

To update, replace the folder's contents with the new release and click the reload button on the extension's card.

To build from source instead, see [Development](#development) and load `dist/`.

## Permissions and privacy

| Permission              | Why                                                                                                                                                                                                                                                                               |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `declarativeNetRequest` | Registers the single rule that matches IDN hosts. Chrome applies the rule itself; the extension never sees your browsing                                                                                                                                                          |
| `<all_urls>`            | A rule that redirects (rather than just blocks) needs host access to the URLs it redirects. Redirecting is what lets the warning page explain why the page was stopped, instead of a bare `ERR_BLOCKED_BY_CLIENT` ([ADR-0002](docs/adr/0002-redirect-to-bundled-warning-page.md)) |

PunyGuard has no content scripts, sends nothing over the network and stores nothing.

### Keep site access at "On all sites"

If you limit **Site access** in `chrome://extensions` to **On click** or to specific sites, the redirect stops working and IDN hosts are no longer blocked. PunyGuard notices this and shows a `!` badge on its toolbar icon.

### The `!` badge

A `!` on the toolbar icon means **blocking is off**. Hover over the icon to see why in the tooltip:

- **The blocking rule could not be registered**: reload the extension in `chrome://extensions`. If it persists, check the service worker's console there for the error.
- **Set site access to "On all sites"**: set it back to **On all sites**.

The badge goes away once both are fine.

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

| File                                                | Change                                                                                                                                                                                                              |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tsconfig.json`                                     | Covers only `src/` (browser code): `module: "preserve"`, `moduleResolution: "bundler"`, `lib: ["esnext", "dom"]`, `types: ["chrome"]`                                                                               |
| `tsconfig.node.json`                                | New. The template's Node.js settings, for `scripts/`, `e2e/` and `*.config.ts`                                                                                                                                      |
| `package.json`                                      | `typecheck` checks both tsconfigs. `build`, `build:watch`, `icons` and `test:e2e` added; `dev` removed. Adds `esbuild`, `@playwright/test`, `@types/chrome`, `@types/punycode` and `punycode`                       |
| `pnpm-workspace.yaml`                               | New. Denies esbuild's build script (`allowBuilds`); its binary comes from optionalDependencies                                                                                                                      |
| `scripts/build.ts`                                  | New. Bundles `src/background.ts` and `src/blocked.ts` with esbuild and copies the manifest, HTML, CSS, icons, `_locales` and the license files (ours and each runtime dependency's, which are bundled) into `dist/` |
| `scripts/icons.ts`, `assets/`, `icons/`             | New. The icon source and the PNGs rendered from it                                                                                                                                                                  |
| `vitest.config.ts`                                  | Resolves packages with the same main fields as the esbuild browser bundle, so tests import the shipped file. Coverage excludes the entry points `src/background.ts` and `src/blocked.ts` instead of `src/index.ts`  |
| `.oxlintrc.json`, `.gitignore`                      | Ignore `dist/`, `test-results/` and `playwright-report/`. `.oxlintrc.json` also turns off `prefer-readonly-parameter-types` in `e2e/` (docs/decisions.md P1)                                                        |
| `.oxfmtrc.json`                                     | Also ignores `CHANGELOG.md`, `.release-please-manifest.json` and `manifest.json`, which release-please rewrites in its own format (docs/decisions.md P2)                                                            |
| `playwright.config.ts`, `e2e/`                      | New. E2E tests that load `dist/` into Chromium                                                                                                                                                                      |
| `.github/workflows/ci.yml`                          | Adds the `e2e` job                                                                                                                                                                                                  |
| `.github/workflows/release.yml`, `release-please-*` | New. release-please and the zip attached to each Release                                                                                                                                                            |
| `src/`                                              | The `greet` sample and `src/index.ts` are removed                                                                                                                                                                   |

## License

[MIT](LICENSE)
