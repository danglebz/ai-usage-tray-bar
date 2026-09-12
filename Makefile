# Thin wrapper over the pnpm scripts in package.json, so `make <tab>` lists the
# commands and nobody has to remember whether it is `format` or `format:check`.
# package.json stays the source of truth; every recipe here delegates to it.

PNPM ?= pnpm

# `make probe ARGS="claude codex"` limits the probe to those providers.
ARGS ?=

.DEFAULT_GOAL := help

## Setup

install: ## Install dependencies (also downloads the Electron binary)
	$(PNPM) install

## Run

start: ## Run the tray app
	$(PNPM) start

demo: ## Run with sample data - no login, notifications muted
	AI_USAGE_DEMO=1 $(PNPM) start

debug: ## Run with notification-decision logging
	AI_USAGE_DEBUG=1 $(PNPM) start

probe: ## Probe providers in the terminal (ARGS="claude codex" for a subset)
	$(PNPM) probe $(ARGS)

## Checks

verify: ## Type check + lint + format check + tests - what CI runs
	$(PNPM) run verify

typecheck: ## tsc, main process and renderer
	$(PNPM) run typecheck

lint: ## eslint
	$(PNPM) run lint

lint-fix: ## eslint --fix
	$(PNPM) run lint:fix

format: ## prettier --write
	$(PNPM) run format

format-check: ## prettier --check
	$(PNPM) run format:check

test: ## vitest run
	$(PNPM) test

test-watch: ## vitest in watch mode
	$(PNPM) run test:watch

## Assets and packaging

dist: ## Build the portable exe into dist/ (unsigned, Windows only)
	$(PNPM) run dist

icon: ## Regenerate assets/icon.ico from assets/icon.png
	$(PNPM) run icon

screenshot: ## Re-render docs/screenshot.png from demo data
	$(PNPM) run screenshot

## Housekeeping

clean: ## Remove the build output in dist/
	rm -rf dist

clean-all: clean ## Also remove node_modules
	rm -rf node_modules

help: ## Show this help
	@awk 'BEGIN{FS=":.*?## "} \
	     /^## /{printf "\n\033[1m%s\033[0m\n", substr($$0,4)} \
	     /^[a-zA-Z_-]+:.*?## /{printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)
	@echo ""

# dist/ and docs/ exist on disk; without .PHONY make would call these targets up to date.
.PHONY: install start demo debug probe verify typecheck lint lint-fix format \
        format-check test test-watch dist icon screenshot clean clean-all help
