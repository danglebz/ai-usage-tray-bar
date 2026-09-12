# Contributing

Thanks for helping. This is a small project; the rules are short.

## Setup

```sh
pnpm install
pnpm start          # run the app
pnpm probe          # or just the providers, in the terminal
pnpm verify         # type check + lint + format check + tests; CI runs the same
```

Node 22.18+ (24 recommended) and pnpm. `pnpm install` also downloads the Electron binary.

## Before you open a pull request

- `pnpm verify` passes. `pnpm lint:fix` and `pnpm format` fix most of what it complains about.
- One change per PR. A provider fix and a UI tweak are two PRs.
- If you touched a provider, say in the PR how you tested it: which plan, and whether you saw a live response. Screenshots of the card help.
- Leave [CHANGELOG.md](CHANGELOG.md) alone. release-please writes it from the commit subjects, so the subject _is_ the changelog line — make it read like one. Editing the file by hand only creates a conflict with the release PR.

## Commit messages

[Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `docs:`, `refactor:`, `build:`, `ci:`, `chore:`, with an optional scope such as `fix(codex):`. The subject says what changed; the body, when there is one, says why — the reasoning that is not visible in the diff.

## Code

- TypeScript, ESM, and **no build step**: Electron and Node strip the types at load time. That means [erasable syntax only](https://www.typescriptlang.org/tsconfig/#erasableSyntaxOnly) — no `enum`, `namespace` or constructor parameter properties — and relative imports carry the `.ts` extension.
- `src/preload.cjs` and `src/renderer/renderer.js` are JavaScript for reasons explained at the top of each file. Keep them type-safe with JSDoc; `pnpm typecheck` covers them.
- Provider responses are untyped JSON. Narrow them with `prop` / `str` / `num` / `isObject` from `_util.ts` rather than casting.
- Comments explain _why_, not what. A provider file starts with where its endpoint and field names come from and when it was last verified.
- Prettier formats, ESLint lints; the config is in the repo root. Don't argue with either in a PR.

## Adding a provider

See the [README](README.md#adding-a-provider). The short version: one file under `src/providers/` exporting a `Provider`, registered in `index.ts`, with a default in `config.ts`. Read only what the CLI already stores; never refresh a token on the user's behalf.

## Reporting a security issue

See [SECURITY.md](SECURITY.md).
