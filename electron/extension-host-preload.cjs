const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("skylineExtensionHost", {
  postMessage: (message) => ipcRenderer.send("extension-host:message", message),
  onStart: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("extension-host:start", listener);
    return () => ipcRenderer.removeListener("extension-host:start", listener);
  },
  onCommand: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("extension-host:command", listener);
    return () => ipcRenderer.removeListener("extension-host:command", listener);
  },
});
