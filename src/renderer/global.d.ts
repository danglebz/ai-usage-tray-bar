// `window.api` is installed by src/preload.cjs; this makes it visible to the type-checked renderer.
import type { Api } from "../types.ts";

declare global {
  interface Window {
    api: Api;
  }
}

export {};
