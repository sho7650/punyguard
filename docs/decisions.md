# Design decisions

A record of what this project decided and why. When a decision changes, update its entry and note the reason for the change.

The decisions that came with the template are in [template-decisions.md](template-decisions.md). That file is replaced by `nix run .#update`, so record this project's decisions here.

## P1. E2E code turns off `prefer-readonly-parameter-types`

- **Decision**: `.oxlintrc.json` turns off `typescript/prefer-readonly-parameter-types` for `e2e/**/*.ts` only.
- **Why**: Playwright hands every test and fixture mutable objects (`Page`, `BrowserContext`, `ServerResponse`, the fixture object itself), so the rule fires on nearly every function in `e2e/` and the only fix would be a disable comment on each one. `src/` keeps the rule.
