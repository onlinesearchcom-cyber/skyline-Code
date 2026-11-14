const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("skyline", {
  openWorkspace: () => ipcRenderer.invoke("workspace:open"),
  refreshWorkspace: () => ipcRenderer.invoke("workspace:refresh"),
  readFile: (filePath) => ipcRenderer.invoke("file:read", filePath),
  saveFile: (filePath, content) => ipcRenderer.invoke("file:save", filePath, content),
  createEntry: (filePath, type) => ipcRenderer.invoke("file:create", filePath, type),
  searchWorkspace: (query) => ipcRenderer.invoke("workspace:search", query),
  gitStatus: () => ipcRenderer.invoke("git:status"),
  gitStage: (filePath) => ipcRenderer.invoke("git:stage", filePath),
  gitUnstage: (filePath) => ipcRenderer.invoke("git:unstage", filePath),
  gitCommit: (message) => ipcRenderer.invoke("git:commit", message),
  gitDiff: (filePath, staged) => ipcRenderer.invoke("git:diff", filePath, staged),
  startTerminal: () => ipcRenderer.invoke("terminal:start"),
  writeTerminal: (data) => ipcRenderer.send("terminal:write", data),
  stopTerminal: () => ipcRenderer.send("terminal:stop"),
  onTerminalData: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on("terminal:data", listener);
    return () => ipcRenderer.removeListener("terminal:data", listener);
  },
  onTerminalExit: (callback) => {
    const listener = (_event, code) => callback(code);
    ipcRenderer.on("terminal:exit", listener);
    return () => ipcRenderer.removeListener("terminal:exit", listener);
  },
});
