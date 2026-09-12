# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/). From 0.1.1 on, release-please writes the entries below from the commit subjects — see [Releasing](README.md#releasing) rather than editing this file.

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
