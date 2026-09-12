// @ts-check
import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig(
  globalIgnores(["node_modules/", "dist/"]),
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    // Main process, providers, CLI and scripts: Node + Electron, ESM.
    files: ["src/**/*.ts", "scripts/**/*.ts", "eslint.config.js"],
    languageOptions: { globals: globals.node },
  },
  {
    // The sandboxed preload is CommonJS by necessity (see the file header).
    files: ["src/preload.cjs"],
    languageOptions: { sourceType: "commonjs", globals: globals.node },
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  {
    // The panel runs in Chromium and talks to the app only through window.api.
    files: ["src/renderer/**/*.js"],
    languageOptions: { sourceType: "script", globals: globals.browser },
  },
  {
    rules: {
      // `catch {}` with a comment is the project's idiom for "expected, nothing to do".
      "no-empty": ["error", { allowEmptyCatch: true }],
      "@typescript-eslint/consistent-type-imports": ["error", { fixStyle: "inline-type-imports" }],
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", caughtErrors: "none" }],
    },
  },
  // Last: switches off every rule Prettier already takes care of.
  prettier,
);
