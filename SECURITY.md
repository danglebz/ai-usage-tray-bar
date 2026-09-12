# Security

## What this app touches

- **Reads** the credential files other CLIs write: `~/.claude/.credentials.json`, `~/.codex/auth.json`, `~/.gemini/oauth_creds.json`, and the GitHub Copilot login under `%LOCALAPPDATA%\github-copilot`. It also runs `gh auth token` when the GitHub CLI is installed. Tokens are used only to call each vendor's usage endpoint and never leave the machine otherwise.
- **Never refreshes** a token. Expired tokens are reported, not renewed.
- **Stores** the keys you enter in Settings (OpenRouter, Anthropic Admin, OpenAI Admin) in plain text at `%APPDATA%\ai-usage-tray\config.json`, file mode `0600`. This matches what the CLIs themselves do; treat that file as a secret.
- The panel runs in a sandboxed, context-isolated renderer with a strict CSP. Secrets are masked before they cross the IPC bridge; the renderer never sees a key.
- Outbound requests go to the vendors listed in the README and nowhere else. There is no telemetry.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting on this repository (**Security → Report a vulnerability**) rather than a public issue. Include the version, what you observed, and how to reproduce it. Expect an acknowledgement within a week.
