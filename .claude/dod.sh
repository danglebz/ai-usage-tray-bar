#!/bin/bash
# Definition-of-Done checks for the agent team, run by ~/.claude/hooks/team-dod.sh in place of
# its default typecheck/lint/test. `pnpm verify` is exactly what CI runs, format:check included,
# so a task that passes here does not fail CI on formatting later.
set -euo pipefail
cd "$(dirname "$0")/.."
pnpm run verify
