# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/). From 0.1.1 on, release-please writes the entries below from the commit subjects — see [Releasing](README.md#releasing) rather than editing this file.

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
