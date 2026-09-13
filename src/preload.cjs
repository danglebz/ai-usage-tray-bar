// Bridge between the sandboxed panel and the main process. Plain CommonJS on purpose: a
// sandboxed preload is loaded by Electron's own script loader, not Node's, so it gets
// neither ESM nor type stripping. It is type-checked through JSDoc against src/types.ts.
"use strict";

const { contextBridge, ipcRenderer } = require("electron");

/** @type {import("./types.ts").Api} */
const api = {
  getUsage: () => ipcRenderer.invoke("usage:get"),
  refresh: () => ipcRenderer.invoke("usage:refresh"),
  getConfig: () => ipcRenderer.invoke("config:get"),
  setConfig: (patch) => ipcRenderer.invoke("config:set", patch),
  quit: () => ipcRenderer.invoke("app:quit"),
  hide: () => ipcRenderer.invoke("app:hide"),
  setPinned: (pinned) => ipcRenderer.invoke("app:setPinned", pinned),
  openConfigDir: () => ipcRenderer.invoke("app:openConfigDir"),
  openExternal: (url) => ipcRenderer.invoke("app:openExternal", url),
  onUsage: (cb) => {
    /** @param {Electron.IpcRendererEvent} _e @param {import("./types.ts").UsageState} state */
    const handler = (_e, state) => cb(state);
    ipcRenderer.on("usage", handler);
    return () => ipcRenderer.removeListener("usage", handler);
  },
};

contextBridge.exposeInMainWorld("api", api);
