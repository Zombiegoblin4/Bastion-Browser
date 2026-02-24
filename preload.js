"use strict";

const { contextBridge, ipcRenderer } = require("electron");

function subscribe(channel, callback) {
  ipcRenderer.on(channel, (_, payload) => {
    callback(payload);
  });
}

contextBridge.exposeInMainWorld("bastionAPI", {
  window: {
    minimize: () => ipcRenderer.invoke("window:minimize"),
    maximizeToggle: () => ipcRenderer.invoke("window:maximize-toggle"),
    close: () => ipcRenderer.invoke("window:close"),
    toggleFullscreen: () => ipcRenderer.invoke("window:toggle-fullscreen"),
    setFullscreen: (value) => ipcRenderer.invoke("window:set-fullscreen", Boolean(value)),
    getState: () => ipcRenderer.invoke("window:state"),
    onState: (callback) => subscribe("window:state", callback)
  },
  app: {
    getMeta: () => ipcRenderer.invoke("app:meta")
  },
  extensions: {
    list: () => ipcRenderer.invoke("extensions:list"),
    loadFromDialog: () => ipcRenderer.invoke("extensions:load-from-dialog"),
    onUpdated: (callback) => subscribe("extensions:updated", callback)
  },
  downloads: {
    list: () => ipcRenderer.invoke("downloads:list"),
    showInFolder: (id) => ipcRenderer.invoke("downloads:show-in-folder", id),
    openFile: (id) => ipcRenderer.invoke("downloads:open-file", id),
    clearCompleted: () => ipcRenderer.invoke("downloads:clear-completed"),
    onUpdated: (callback) => subscribe("downloads:updated", callback),
    onDone: (callback) => subscribe("downloads:done", callback)
  },
  history: {
    list: () => ipcRenderer.invoke("history:list"),
    append: (entry) => ipcRenderer.invoke("history:append", entry),
    clear: () => ipcRenderer.invoke("history:clear"),
    onUpdated: (callback) => subscribe("history:updated", callback)
  },
  updates: {
    getStatus: () => ipcRenderer.invoke("updates:get-status"),
    getConfig: () => ipcRenderer.invoke("updates:get-config"),
    check: () => ipcRenderer.invoke("updates:check"),
    download: () => ipcRenderer.invoke("updates:download"),
    install: () => ipcRenderer.invoke("updates:install"),
    updateConfig: (patch) => ipcRenderer.invoke("updates:update-config", patch || {}),
    onStatus: (callback) => subscribe("updates:status", callback),
    onConfig: (callback) => subscribe("updates:config", callback)
  },
  privacy: {
    getConfig: () => ipcRenderer.invoke("privacy:get-config"),
    getStats: () => ipcRenderer.invoke("privacy:get-stats"),
    updateConfig: (patch) => ipcRenderer.invoke("privacy:update-config", patch || {}),
    clearData: (scope = "all") => ipcRenderer.invoke("privacy:clear-data", scope),
    onConfig: (callback) => subscribe("privacy:config", callback),
    onStats: (callback) => subscribe("privacy:stats", callback)
  },
  navigation: {
    onNewTab: (callback) => subscribe("navigation:new-tab", callback)
  }
});
