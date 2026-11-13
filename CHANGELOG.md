# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/). From 0.1.1 on, release-please writes the entries below from the commit subjects — see [Releasing](README.md#releasing) rather than editing this file.

## [0.1.3](https://github.com/danglebz/ai-usage-tray-bar/compare/v0.1.2...v0.1.3) (2026-11-13)


### Added

* add a pin button that keeps the panel open ([2a9662e](https://github.com/danglebz/ai-usage-tray-bar/commit/2a9662e20a5a468c99b0b5f59b129f26ac87070f))
* **claude-console:** report tokens and complete monthly spend ([db243f9](https://github.com/danglebz/ai-usage-tray-bar/commit/db243f927d09cb973d443818659998e05f77f334))
* **claude:** show the meters the server reports, ready for plans without a 5-hour limit ([#28](https://github.com/danglebz/ai-usage-tray-bar/issues/28)) ([f785cfb](https://github.com/danglebz/ai-usage-tray-bar/commit/f785cfbfd479ca984861565de5a183ac3b03ffe1))
* **fal:** show account credits and monthly API spend ([685abf0](https://github.com/danglebz/ai-usage-tray-bar/commit/685abf0597aef3ff92c75d65e79d4f3d47b47a99))
* **google:** add separate Gemini and Veo usage monitors ([49c561f](https://github.com/danglebz/ai-usage-tray-bar/commit/49c561fa8f6daf156b36f86363886e70a761f5b2))
* **google:** keep the Google cards to the lines worth reading ([#25](https://github.com/danglebz/ai-usage-tray-bar/issues/25)) ([414c16e](https://github.com/danglebz/ai-usage-tray-bar/commit/414c16e79c9448585354eed6b59ce1f9fa36baa4))
* **google:** link Gemini project spending ([77a85ca](https://github.com/danglebz/ai-usage-tray-bar/commit/77a85ca017f5664818fdefa6f8b8bd04ecc54df9))
* **google:** show model usage and link billing balances ([2168f60](https://github.com/danglebz/ai-usage-tray-bar/commit/2168f60fdc5d3fa02fc08d4f37388751a16a7a26))
* **panel:** drag the panel and its cards, and tidy Settings ([#26](https://github.com/danglebz/ai-usage-tray-bar/issues/26)) ([cf118b0](https://github.com/danglebz/ai-usage-tray-bar/commit/cf118b03622c540c28554964cf1026f390de9b12))
* **providers:** add monthly usage target progress bars ([d1c6077](https://github.com/danglebz/ai-usage-tray-bar/commit/d1c6077e51200872ebeb08017f596a2f12b1acb3))
* **tray:** allow vertical resizing and remember panel height ([0b3c7ab](https://github.com/danglebz/ai-usage-tray-bar/commit/0b3c7ab76ef3e267b51ec9a2a40203998587748f))
* **tray:** display usage progress bars with local monthly targets ([4a9c5cd](https://github.com/danglebz/ai-usage-tray-bar/commit/4a9c5cd4b703c3ced2b88e73e995d3580ad75cd1))


### Fixed

* **claude-console:** distinguish outages from missing access ([8ec7959](https://github.com/danglebz/ai-usage-tray-bar/commit/8ec7959618d17fe8b1fed19f7c739e5380691fe9))
* **claude-console:** explain organization-scoped key access ([348af7d](https://github.com/danglebz/ai-usage-tray-bar/commit/348af7dcbb9080bbbaeb41b9c26170959a4f3409))
* **claude-console:** identify valid keys without report access ([2e9725d](https://github.com/danglebz/ai-usage-tray-bar/commit/2e9725d5635b883afd0c84f3d6d8626e3b7f2e6f))
* **google:** label quota windows and prefer project credentials ([abbe3d6](https://github.com/danglebz/ai-usage-tray-bar/commit/abbe3d6733bececd746dd34da842803f3dfd4049))
* **settings:** accept pasted provider keys without project env files ([4d8da93](https://github.com/danglebz/ai-usage-tray-bar/commit/4d8da93b20eb28829a6333646d86c650849c7810))


### Internal

* check commit messages with commitlint in a git hook ([e206822](https://github.com/danglebz/ai-usage-tray-bar/commit/e2068220f162f25cb4a67074ef2dd5574b6e77b9))
* **deps-dev:** bump electron from 44.3.0 to 44.11.1 ([#24](https://github.com/danglebz/ai-usage-tray-bar/issues/24)) ([e246f66](https://github.com/danglebz/ai-usage-tray-bar/commit/e246f66eb99afb4c3c5890354d43e19c81f93a6d))
* **deps-dev:** bump electron-builder from 26.15.3 to 26.18.0 ([#18](https://github.com/danglebz/ai-usage-tray-bar/issues/18)) ([90a221a](https://github.com/danglebz/ai-usage-tray-bar/commit/90a221ae5113b04f191c5fe48fb7e235ba87da80))
* **deps-dev:** bump the dev-tooling group across 1 directory with 8 updates ([#16](https://github.com/danglebz/ai-usage-tray-bar/issues/16)) ([b9e9571](https://github.com/danglebz/ai-usage-tray-bar/commit/b9e95716123ee86f1c82778d03b6e610e3d0d872))

## [0.1.2](https://github.com/danglebz/ai-usage-tray-bar/compare/v0.1.1...v0.1.2) (2026-09-12)


### Fixed

* keep the release build from failing on its own changelog ([0e05afa](https://github.com/danglebz/ai-usage-tray-bar/commit/0e05afa1747780b0181c09e2cbfd82e6e83d418f))

## [0.1.1](https://github.com/danglebz/ai-usage-tray-bar/compare/v0.1.0...v0.1.1) (2026-09-12)


### Internal

* **deps-dev:** bump @types/node ([#6](https://github.com/danglebz/ai-usage-tray-bar/issues/6)) ([026d49a](https://github.com/danglebz/ai-usage-tray-bar/commit/026d49a49b73cc930339c3ac78c97b9291daa5d0))
* **deps:** bump actions/checkout from 4 to 7 ([#2](https://github.com/danglebz/ai-usage-tray-bar/issues/2)) ([438a1a7](https://github.com/danglebz/ai-usage-tray-bar/commit/438a1a7c4ea7c41b1611ae93e01c990068aa683a))
* **deps:** bump actions/setup-node from 4 to 7 ([#3](https://github.com/danglebz/ai-usage-tray-bar/issues/3)) ([7c7bd26](https://github.com/danglebz/ai-usage-tray-bar/commit/7c7bd26d1d380030583498d2835a60c0a2a2e73b))
* **deps:** bump pnpm/action-setup from 4 to 6 ([#1](https://github.com/danglebz/ai-usage-tray-bar/issues/1)) ([c81f764](https://github.com/danglebz/ai-usage-tray-bar/commit/c81f76482423ccf5c342ba3e904292fc9ee68f49))
* **deps:** bump softprops/action-gh-release from 2 to 3 ([#4](https://github.com/danglebz/ai-usage-tray-bar/issues/4)) ([ecba035](https://github.com/danglebz/ai-usage-tray-bar/commit/ecba035dbf358b332d1c7dc8aefe9bf54fb995ff))

## [0.1.0] - 2026-09-13

First release.

### Added

- Windows tray app showing remaining quota and credits for Claude Code, Codex CLI, GitHub Copilot, Gemini CLI, OpenRouter, and the Anthropic and OpenAI pay-as-you-go APIs, one card per provider.
- Providers read the credentials each CLI already stores; nothing is refreshed on the user's behalf. Expired tokens are reported with what to do.
- Claude Code card also shows an estimate of tokens and cost over the last 5 hours and 7 days from local session logs, which keeps working offline and when the token has expired.
- Windows notification when any limit crosses a configurable threshold (default 90 %). One toast per refresh, each limit announced once per period, nothing once a limit is already full.
- Settings panel: refresh interval, notification threshold, start with Windows, and a switch plus any needed keys per provider. Settings apply as they are changed.
- Terminal probe (`pnpm probe [ids…]`) printing the same snapshots without the GUI.
- `Start AI Usage Tray.cmd` launcher for machines where Smart App Control blocks unsigned executables.
- Portable exe build via electron-builder.

### Internal

- TypeScript throughout, run directly by Electron / Node with native type stripping — no build step.
- pnpm, ESLint, Prettier, Vitest, and CI that runs them on every push; release workflow that builds the exe for version tags.

[0.1.0]: https://github.com/danglebz/ai-usage-tray-bar/releases/tag/v0.1.0
