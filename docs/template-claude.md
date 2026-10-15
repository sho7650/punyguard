# Template conventions (copier-ts7)

This file comes from the copier-ts7 template and is replaced by `nix run .#update`; do not edit it. Put project-specific instructions in `CLAUDE.md`.

The template's design decisions and their reasons live in `docs/template-decisions.md`. Read it before changing the setup. Record the project's own decisions in `docs/decisions.md`.

## Running commands

Node.js and pnpm come from `flake.nix`. Agent shells are non-interactive and have no direnv hook, so **always prefix commands with `direnv exec .`** (D15). Without the prefix, a globally installed Node.js may run instead.

```sh
direnv exec . pnpm run check      # typecheck → lint → format:check → test:coverage
direnv exec . pnpm run test:run
direnv exec . node src/index.ts
```

pnpm 12 has no `-s` flag; use `pnpm run <script>`.

## Responsibilities

- Running: Node.js type stripping (`node src/x.ts`); nothing is emitted
- Type errors: `tsc` (TypeScript 7)
- Suspicious code: `oxlint` (type-aware, `typeCheck` disabled)
- Formatting: `oxfmt`
- Behavior: `vitest`; tests live next to the source as `src/**/*.test.ts`
