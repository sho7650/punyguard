# punyguard

Chrome extension that blocks navigation to IDN (xn--) hosts

Generated from [copier-ts7](https://github.com/sho7650/copier-ts7), a TypeScript 7 template built on native toolchains: Nix provides the runtime, Node.js runs `.ts` files directly, and the type checker, linter and formatter are all native binaries.

## Stack

| Area            | Tool                                                    |
| --------------- | ------------------------------------------------------- |
| Environment     | Nix flake dev shell + direnv                            |
| Runtime         | Node.js 26 (type stripping, no build step)              |
| Package manager | pnpm 12                                                 |
| Type checking   | TypeScript 7 (`tsc`, native)                            |
| Testing         | Vitest 5 + V8 coverage (80% threshold)                  |
| Linting         | oxlint + oxlint-tsgolint (type-aware)                   |
| Formatting      | oxfmt                                                   |
| CI              | GitHub Actions (`nix develop --command pnpm run check`) |

The reasons behind each choice are recorded in [docs/template-decisions.md](docs/template-decisions.md). Record this project's own decisions in [docs/decisions.md](docs/decisions.md).

## Requirements

- [Nix](https://nixos.org/download/) with flakes enabled
- [direnv](https://direnv.net/), ideally with [nix-direnv](https://github.com/nix-community/nix-direnv)

Supported systems: `aarch64-darwin`, `aarch64-linux`, `x86_64-linux`.

## Getting started

```sh
direnv allow          # loads Node.js and pnpm from flake.nix
mise trust            # only if you use mise (see docs/template-decisions.md D14)
pnpm install          # creates pnpm-lock.yaml; commit it
git init -b main && git add -A && git commit -m "chore: initial commit from copier-ts7"
pnpm run check
```

Without direnv, prefix commands with `nix develop --command`.

Then replace the `greet` sample in `src/`.

## Updating from the template

```sh
nix run .#update
```

The working tree must be clean. Your earlier answers are reused, so nothing is asked. Copier merges template changes into your files; resolve any conflicts it reports, then run `pnpm install` and `pnpm run check`. What each release changes is in the [release notes](https://github.com/sho7650/copier-ts7/releases).

Files that belong to the template are replaced or merged on update: do not run `nix flake update` (the template updates `flake.lock`), and do not edit `docs/template-decisions.md` or `docs/template-claude.md`. `README.md`, `LICENSE`, `CLAUDE.md` and `docs/decisions.md` are yours and are never touched by an update.

## Differences from the template

This project is a Chrome extension, not a Node.js program, so it changes the template in the places below. Keep them in mind when `nix run .#update` reports conflicts.

| File                           | Change                                                                                                                                               |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tsconfig.json`                | Covers only `src/` (browser code): `module: "preserve"`, `moduleResolution: "bundler"`, `lib: ["esnext", "dom"]`, `types: ["chrome"]`                |
| `tsconfig.node.json`           | New. The template's Node.js settings, for `scripts/`, `e2e/` and `*.config.ts`                                                                       |
| `package.json`                 | `typecheck` checks both tsconfigs. `build` and `build:watch` added; `dev` removed. Adds `esbuild`, `@types/chrome`, `@types/punycode` and `punycode` |
| `pnpm-workspace.yaml`          | New. Denies esbuild's build script (`allowBuilds`); its binary comes from optionalDependencies                                                       |
| `scripts/build.ts`             | New. Bundles `src/background.ts` and `src/blocked.ts` with esbuild and copies the manifest, HTML, CSS and `_locales` into `dist/`                    |
| `vitest.config.ts`             | Coverage excludes the entry points `src/background.ts` and `src/blocked.ts` instead of `src/index.ts`                                                |
| `.oxlintrc.json`, `.gitignore` | Ignore `dist/`                                                                                                                                       |
| `src/`                         | `src/index.ts` is removed                                                                                                                            |

## Scripts

| Script                   | What it does                                    |
| ------------------------ | ----------------------------------------------- |
| `pnpm run build`         | Build the unpacked extension into `dist/`       |
| `pnpm run build:watch`   | Rebuild `dist/` on every change                 |
| `pnpm run typecheck`     | Type-check `src/` and the Node.js side          |
| `pnpm test`              | Run Vitest in watch mode                        |
| `pnpm run test:run`      | Run tests once                                  |
| `pnpm run test:coverage` | Run tests with coverage thresholds              |
| `pnpm run lint`          | Lint with oxlint (type-aware)                   |
| `pnpm run format`        | Format with oxfmt                               |
| `pnpm run format:check`  | Check formatting                                |
| `pnpm run check`         | typecheck → lint → format:check → test:coverage |

## Conventions

- Import local modules with the `.ts` extension (`import { greet } from "./greet.ts"`); nothing is emitted.
- Put tests next to the source as `*.test.ts`.
- Type errors belong to `tsc`; oxlint reports suspicious code only (`typeCheck` is disabled).

## Editor

Open the folder in VS Code and install the recommended extensions (TypeScript 7, Oxc, direnv). The workspace settings point the editor at `node_modules/typescript` so the editor and CLI use the same TypeScript version.

## License

[MIT](LICENSE)
