export function installBrowserBridge() {
  if (window.skyline) return;

  const emptyResults = {
    restoreWorkspace: null,
    openWorkspace: null,
    openRecentWorkspace: null,
    refreshWorkspace: { tree: [] },
    recentWorkspaces: [],
    listExtensions: [],
    listExtensionCommands: [],
    searchExtensions: [],
    installExtension: [],
    uninstallExtension: [],
    activateExtension: [],
    disableExtension: [],
    runExtensionCommand: { running: false },
    getAgentModels: [],
    getWorkspaceEditorSettings: null,
    setWorkspaceEditorSettings: {},
    readFile: { content: "", modifiedAt: 0, version: "browser-preview" },
    saveFile: { modifiedAt: 0, version: "browser-preview" },
    createEntry: { tree: [] },
    searchWorkspace: [],
    gitStatus: { branch: "", files: [] },
    gitStage: { branch: "", files: [] },
    gitUnstage: { branch: "", files: [] },
    gitCommit: { branch: "", files: [] },
    gitDiff: "",
    chatWithAgent: {
      messages: [],
      text: "Skyline AI requires the desktop app.",
      pendingEdit: null,
    },
    applyAgentEdit: { path: "", modifiedAt: 0, version: "browser-preview" },
    runFile: null,
    startTerminal: { running: false },
  };

  // The proxy implements the bridge dynamically so the browser preview needs no Electron APIs.
  window.skyline = new Proxy(/** @type {SkylineBridge} */ ({}), {
    get(_target, property) {
      if (property === "onCloseRequest" ||
          property === "onWorkspaceChange" ||
          property === "onWorkspaceWatchError" ||
          property === "onTerminalData" ||
          property === "onTerminalExit" ||
          property === "onExtensionRuntimeEvent" ||
          property === "onRunOutput" ||
          property === "onRunExit") {
        return () => () => {};
      }
      if (property === "setDirtyState" ||
          property === "respondToCloseRequest" ||
          property === "writeTerminal" ||
          property === "stopTerminal" ||
          property === "stopRun") {
        return () => {};
      }
      if (property === "runFile") {
        return async () => {
          throw new Error("Running files is only available in the Skyline desktop app.");
        };
      }
      if (typeof property === "string" && property in emptyResults) {
        return async () => emptyResults[property];
      }
      return async () => null;
    },
  });
}
