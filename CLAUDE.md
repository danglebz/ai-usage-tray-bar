# CLAUDE.md

## Team

- Stack: Electron 44 tray app, Windows only. TypeScript 6 (ESM) with no build step: Node 24 strips the types at load time. Vanilla JS + CSS renderer with no framework. Vitest 5, ESLint 10, Prettier 3, pnpm 11, electron-builder (portable exe), release-please.
- Layout: single app, no workspace packages. `src/main.ts` main process · `src/preload.cjs` IPC bridge · `src/renderer/` the panel · `src/providers/` one file per provider · `src/types.ts` shared contract · `scripts/` icon and screenshot tools · tests sit next to the source as `*.test.ts`.
- Commands: install `pnpm install` · dev `pnpm start` (sample data: `AI_USAGE_DEMO=1 pnpm start`; providers only, in the terminal: `pnpm probe [id…]`) · typecheck `pnpm typecheck` · lint `pnpm lint` · format `pnpm format:check` · test `pnpm test` · everything CI runs `pnpm verify` · build `pnpm dist` · e2e: none
- Ownership:
  - frontend: `src/renderer/**`, `src/popup.ts`, `src/icon.ts`, `assets/**`, `scripts/**`, `docs/screenshot.png`
  - backend: `src/main.ts`, `src/preload.cjs`, `src/config.ts`, `src/types.ts` (shared contract: tell frontend when it changes), `src/cli.ts`, `src/demo.ts`, `src/providers/**`
  - qa: `src/**/*.test.ts`
  - sre: `.github/workflows/**`, `.github/dependabot.yml`, `release-please-config.json`, `.release-please-manifest.json`, the `scripts` and `build` fields of `package.json`, `pnpm-workspace.yaml`, `tsconfig*.json`, `eslint.config.js`, `.prettierrc.json`, `commitlint.config.js`, `.husky/**`, `Makefile`, `Start AI Usage Tray.cmd`, `.claude/dod.sh`
  - tech-writer: `README.md`, `CONTRIBUTING.md`, `SECURITY.md`, `.github/ISSUE_TEMPLATE/**`, `.github/PULL_REQUEST_TEMPLATE.md`
- Environments: local `pnpm start` on Windows · staging none · prod: GitHub Releases of danglebz/ai-usage-tray-bar (the portable exe), cut by merging the release-please PR (prod changes need human approval)
- Docs live in: README.md (install, use, development, layout, adding a provider, releasing), CONTRIBUTING.md, SECURITY.md. release-please writes CHANGELOG.md.
- Project rules:
  - Releases are human-only. Agents never merge the release-please PR, push a `v*` tag, or dispatch `release.yml`.
  - Work on a branch and open a PR. Never commit or push to `main`: CI checks a PR before it reaches `main`, and every push to `main` updates the release PR.
  - Use Conventional Commits. commitlint checks them, and release-please turns them into the next version and the changelog. Never use `--no-verify`.
  - Never edit CHANGELOG.md by hand.
  - Use erasable TypeScript only: no `enum`, `namespace` or parameter properties. Relative imports end in `.ts`.
  - `src/preload.cjs` and `src/renderer/renderer.js` stay JavaScript, typed through JSDoc.
  - Narrow provider JSON with `prop`/`str`/`num`/`isObject` from `src/providers/_util.ts`. Don't cast.
  - Never refresh a user's token. Read only what each CLI already stores. Outbound requests go only to the vendors listed in the README. No telemetry.
  - Secrets are masked before they cross IPC, and the renderer never sees a key. Keep the strict CSP.
  - A provider file starts with a comment saying where its endpoint and fields come from and when they were last verified. Test a provider change against a live response, and say which plan it was tested on.
  - VS Code terminals export `ELECTRON_RUN_AS_NODE=1`. Launch Electron with `env -u ELECTRON_RUN_AS_NODE pnpm start` (same for `pnpm icon`).
  - One change per PR.
