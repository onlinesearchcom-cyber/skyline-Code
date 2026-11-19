const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("skyline", {
  openWorkspace: () => ipcRenderer.invoke("workspace:open"),
  refreshWorkspace: () => ipcRenderer.invoke("workspace:refresh"),
  recentWorkspaces: () => ipcRenderer.invoke("workspace:recent"),
  openRecentWorkspace: (workspacePath) => ipcRenderer.invoke("workspace:open-recent", workspacePath),
  restoreWorkspace: () => ipcRenderer.invoke("workspace:restore"),
  listExtensions: () => ipcRenderer.invoke("extensions:list"),
  listExtensionCommands: () => ipcRenderer.invoke("extensions:commands"),
  searchExtensions: (query) => ipcRenderer.invoke("extensions:search", query),
  installExtension: (namespace, name, version) =>
    ipcRenderer.invoke("extensions:install", namespace, name, version),
  uninstallExtension: (namespace, name) =>
    ipcRenderer.invoke("extensions:uninstall", namespace, name),
  activateExtension: (namespace, name) =>
    ipcRenderer.invoke("extensions:activate", namespace, name),
  disableExtension: (namespace, name) =>
    ipcRenderer.invoke("extensions:disable", namespace, name),
  runExtensionCommand: (extensionId, command) =>
    ipcRenderer.invoke("extensions:run-command", extensionId, command),
  getAgentModels: () => ipcRenderer.invoke("agent:models"),
  chatWithAgent: (model, messages) => ipcRenderer.invoke("agent:chat", model, messages),
  createAgentFile: (relativePath, content) =>
    ipcRenderer.invoke("agent:create-file", relativePath, content),
  applyAgentEdit: (relativePath, content, expectedVersion) =>
    ipcRenderer.invoke("agent:apply-edit", relativePath, content, expectedVersion),
  onExtensionRuntimeEvent: (callback) => {
    const listener = (_event, message) => callback(message);
    ipcRenderer.on("extensions:runtime-event", listener);
    return () => ipcRenderer.removeListener("extensions:runtime-event", listener);
  },
  getWorkspaceEditorSettings: (workspacePath) => ipcRenderer.invoke("workspace:get-editor-settings", workspacePath),
  setWorkspaceEditorSettings: (workspacePath, settings) => ipcRenderer.invoke("workspace:set-editor-settings", workspacePath, settings),
  readFile: (filePath) => ipcRenderer.invoke("file:read", filePath),
  saveFile: (filePath, content, expectedVersion) => ipcRenderer.invoke("file:save", filePath, content, expectedVersion),
  createEntry: (filePath, type) => ipcRenderer.invoke("file:create", filePath, type),
  searchWorkspace: (query) => ipcRenderer.invoke("workspace:search", query),
  gitStatus: () => ipcRenderer.invoke("git:status"),
  gitStage: (filePath) => ipcRenderer.invoke("git:stage", filePath),
  gitUnstage: (filePath) => ipcRenderer.invoke("git:unstage", filePath),
  gitCommit: (message) => ipcRenderer.invoke("git:commit", message),
  gitDiff: (filePath, staged) => ipcRenderer.invoke("git:diff", filePath, staged),
  runFile: (filePath) => ipcRenderer.invoke("file:run", filePath),
  stopRun: () => ipcRenderer.send("file:run-stop"),
  onRunOutput: (callback) => {
    const listener = (_event, output) => callback(output);
    ipcRenderer.on("run:output", listener);
    return () => ipcRenderer.removeListener("run:output", listener);
  },
  onRunExit: (callback) => {
    const listener = (_event, code) => callback(code);
    ipcRenderer.on("run:exit", listener);
    return () => ipcRenderer.removeListener("run:exit", listener);
  },
  startTerminal: () => ipcRenderer.invoke("terminal:start"),
  writeTerminal: (data) => ipcRenderer.send("terminal:write", data),
  stopTerminal: () => ipcRenderer.send("terminal:stop"),
  setDirtyState: (dirty) => ipcRenderer.send("app:dirty-state", dirty),
  respondToCloseRequest: (shouldClose) => ipcRenderer.send("app:close-response", shouldClose),
  onCloseRequest: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("app:close-requested", listener);
    return () => ipcRenderer.removeListener("app:close-requested", listener);
  },
  onWorkspaceChange: (callback) => {
    const listener = (_event, paths) => callback(paths);
    ipcRenderer.on("workspace:changed", listener);
    return () => ipcRenderer.removeListener("workspace:changed", listener);
  },
  onWorkspaceWatchError: (callback) => {
    const listener = (_event, message) => callback(message);
    ipcRenderer.on("workspace:watch-error", listener);
    return () => ipcRenderer.removeListener("workspace:watch-error", listener);
  },
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
