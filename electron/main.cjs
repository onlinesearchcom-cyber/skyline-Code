const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const { spawn } = require("node:child_process");
const { execFile } = require("node:child_process");
const { watch } = require("node:fs");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { promisify } = require("node:util");
const { assertExpectedFileVersion, getFileVersion } = require("./file-version.cjs");
const {
  parseWorkspaceEditorSettings,
  serializeWorkspaceEditorSettings,
} = require("./editor-settings.cjs");
const {
  extensionDirectory,
  extensionId,
  parseGalleryResults,
  validateExtensionDownloadUrl,
} = require("./extensions.cjs");
const {
  extractVsix,
  resolveSkylineWebExtensionEntry,
  validateExtensionRuntimeMessage,
} = require("./extension-package.cjs");
const {
  createExtensionHostDocument,
  createExtensionWorkerSource,
} = require("./extension-host.cjs");
const {
  agentTools,
  getOllamaModels,
  normalizeAgentMessages,
  parseAgentToolCall,
} = require("./ai-agent.cjs");

const execFileAsync = promisify(execFile);
let workspaceRoot = null;
let terminalProcess = null;
let terminalSender = null;
let mainWindow = null;
let workspaceDirty = false;
let closeRequestPending = false;
let allowWindowClose = false;
let workspaceWatcher = null;
let workspaceWatchTimer = null;
let changedWorkspacePaths = new Set();
let extensionOperationQueue = Promise.resolve();
const extensionHosts = new Map();
const extensionCommands = new Map();

const withExtensionOperation = (operation) => {
  const result = extensionOperationQueue.then(operation, operation);
  extensionOperationQueue = result.then(() => undefined, () => undefined);
  return result;
};

const stopWorkspaceWatcher = () => {
  workspaceWatcher?.close();
  workspaceWatcher = null;
  if (workspaceWatchTimer) clearTimeout(workspaceWatchTimer);
  workspaceWatchTimer = null;
  changedWorkspacePaths.clear();
};

const startWorkspaceWatcher = (root) => {
  stopWorkspaceWatcher();
  try {
    workspaceWatcher = watch(root, { recursive: true }, (_event, filename) => {
      if (!filename) {
        changedWorkspacePaths.add("*");
      } else {
        const relativePath = filename.toString().replace(/\\/g, "/");
        if (relativePath.split("/").some((part) => ["node_modules", ".git"].includes(part))) return;
        changedWorkspacePaths.add(relativePath);
      }

      if (workspaceWatchTimer) clearTimeout(workspaceWatchTimer);
      workspaceWatchTimer = setTimeout(() => {
        workspaceWatchTimer = null;
        const paths = [...changedWorkspacePaths];
        changedWorkspacePaths.clear();
        if (mainWindow && workspaceRoot === root) {
          mainWindow.webContents.send("workspace:changed", paths);
        }
      }, 120);
    });
    workspaceWatcher.on("error", (error) => {
      mainWindow?.webContents.send("workspace:watch-error", error.message);
    });
  } catch (error) {
    mainWindow?.webContents.send("workspace:watch-error", error.message);
  }
};

const recentWorkspacesPath = () => path.join(app.getPath("userData"), "recent-workspaces.json");
const extensionsRoot = () => path.join(app.getPath("userData"), "extensions");
const extensionsIndexPath = () => path.join(extensionsRoot(), "installed.json");

const readInstalledExtensions = async () => {
  try {
    const installed = JSON.parse(await fs.readFile(extensionsIndexPath(), "utf8"));
    if (!Array.isArray(installed)) throw new Error("Installed extension data is invalid.");
    installed.forEach((item) => {
      if (!item || item.id !== extensionId(item.namespace, item.name) ||
          typeof item.version !== "string" ||
          !/^[a-zA-Z0-9][a-zA-Z0-9.+_-]{0,63}$/.test(item.version)) {
        throw new Error("Installed extension data is invalid.");
      }
      item.trusted = item.trusted === true;
      item.webEntrypoint = typeof item.webEntrypoint === "string" ? item.webEntrypoint : null;
      item.enabled = item.enabled === true && item.trusted && Boolean(item.webEntrypoint);
    });
    return installed;
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
};

const writeInstalledExtensions = async (installed) => {
  const root = extensionsRoot();
  await fs.mkdir(root, { recursive: true });
  const indexPath = extensionsIndexPath();
  const temporaryPath = `${indexPath}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(installed, null, 2)}\n`, "utf8");
  await fs.rename(temporaryPath, indexPath);
};

const fetchRegistryJson = async (url) => {
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    redirect: "error",
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(`Open VSX request failed (${response.status}).`);
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > 2 * 1024 * 1024) {
    throw new Error("Open VSX response exceeds the 2 MB limit.");
  }
  const contents = await response.text();
  if (Buffer.byteLength(contents, "utf8") > 2 * 1024 * 1024) {
    throw new Error("Open VSX response exceeds the 2 MB limit.");
  }
  return JSON.parse(contents);
};

const fetchOllamaModels = async () => {
  let response;
  try {
    response = await fetch("http://127.0.0.1:11434/api/tags", {
      headers: { Accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(5000),
    });
  } catch (error) {
    throw new Error(`Ollama is unavailable at 127.0.0.1:11434: ${error.message}`);
  }
  if (!response.ok) throw new Error(`Ollama model list failed (${response.status}).`);
  return getOllamaModels(await response.json());
};

const downloadExtensionArchive = async (downloadUrl) => {
  const url = validateExtensionDownloadUrl(downloadUrl);
  const response = await fetch(url, {
    headers: { Accept: "application/octet-stream" },
    redirect: "error",
    signal: AbortSignal.timeout(60000),
  });
  if (!response.ok) throw new Error(`Extension download failed (${response.status}).`);
  const declaredLength = Number(response.headers.get("content-length"));
  const maximumSize = 50 * 1024 * 1024;
  if (Number.isFinite(declaredLength) && declaredLength > maximumSize) {
    throw new Error("Extension package exceeds the 50 MB download limit.");
  }
  if (!response.body) throw new Error("The extension registry returned an empty package.");

  const chunks = [];
  let totalSize = 0;
  for await (const chunk of response.body) {
    totalSize += chunk.length;
    if (totalSize > maximumSize) {
      throw new Error("Extension package exceeds the 50 MB download limit.");
    }
    chunks.push(Buffer.from(chunk));
  }
  const archive = Buffer.concat(chunks, totalSize);
  if (archive.length < 4 || archive[0] !== 0x50 || archive[1] !== 0x4b) {
    throw new Error("The registry did not return a valid VSIX archive.");
  }
  return archive;
};

const extensionCommandKey = (id, command) => `${id}\0${command}`;

const stopExtensionHost = (id) => {
  const host = extensionHosts.get(id);
  if (!host) return;
  clearTimeout(host.activationTimer);
  extensionHosts.delete(id);
  for (const [key, command] of extensionCommands) {
    if (command.extensionId === id) {
      extensionCommands.delete(key);
      mainWindow?.webContents.send("extensions:runtime-event", {
        type: "command-unregister",
        extensionId: id,
        command: command.command,
      });
    }
  }
  if (!host.started) host.rejectStarted(new Error("Extension host closed before it activated."));
  if (!host.window.isDestroyed()) host.window.close();
};

const handleExtensionHostMessage = (id, message) => {
  const normalized = validateExtensionRuntimeMessage(id, message);
  if (!normalized) return;

  if (normalized.type === "command-register") {
    const key = extensionCommandKey(id, normalized.command);
    if (extensionCommands.has(key)) return;
    extensionCommands.set(key, normalized);
  } else if (normalized.type === "command-unregister") {
    extensionCommands.delete(extensionCommandKey(id, normalized.command));
  } else if (normalized.type === "activated") {
    const host = extensionHosts.get(id);
    if (host && !host.started) {
      host.started = true;
      clearTimeout(host.activationTimer);
      host.resolveStarted();
    }
  } else if (normalized.type === "activation-error") {
    const host = extensionHosts.get(id);
    if (host && !host.started) {
      clearTimeout(host.activationTimer);
      host.rejectStarted(new Error(normalized.message));
      stopExtensionHost(id);
    }
  }

  mainWindow?.webContents.send("extensions:runtime-event", normalized);
};

const startExtensionHost = async (extension) => {
  if (extensionHosts.has(extension.id)) return;
  const webEntrypoint = resolveSkylineWebExtensionEntry({
    skyline: { webExtension: extension.webEntrypoint },
  });
  if (!webEntrypoint) {
    throw new Error("This package does not declare a Skyline web-extension entry point.");
  }

  const packageRoot = path.join(
    extensionsRoot(),
    path.basename(extensionDirectory(extensionsRoot(), extension.namespace, extension.name, extension.version)),
    "package",
  );
  const entryPath = path.resolve(packageRoot, webEntrypoint);
  if (!isPathInside(packageRoot, entryPath)) throw new Error("The extension entry point is outside its package.");
  const stat = await fs.stat(entryPath);
  if (!stat.isFile() || stat.size > 5 * 1024 * 1024) {
    throw new Error("The extension entry point must be a file no larger than 5 MB.");
  }
  const source = await fs.readFile(entryPath, "utf8");
  const hostWindow = new BrowserWindow({
    show: false,
    width: 1,
    height: 1,
    parent: mainWindow ?? undefined,
    webPreferences: {
      preload: path.join(__dirname, "extension-host-preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      devTools: false,
    },
  });
  hostWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  hostWindow.webContents.on("will-navigate", (event) => event.preventDefault());

  let resolveStarted;
  let rejectStarted;
  const started = new Promise((resolve, reject) => {
    resolveStarted = resolve;
    rejectStarted = reject;
  });
  started.catch(() => {});
  const host = {
    window: hostWindow,
    started: false,
    resolveStarted,
    rejectStarted,
    activationTimer: setTimeout(() => {
      host.rejectStarted(new Error("Extension activation timed out after 10 seconds."));
      stopExtensionHost(extension.id);
    }, 10000),
  };
  extensionHosts.set(extension.id, host);
  hostWindow.on("closed", () => {
    if (extensionHosts.get(extension.id) !== host) return;
    stopExtensionHost(extension.id);
  });

  try {
    await hostWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(createExtensionHostDocument())}`);
    hostWindow.webContents.send("extension-host:start", {
      workerSource: createExtensionWorkerSource(source),
    });
    await started;
  } catch (error) {
    stopExtensionHost(extension.id);
    throw error;
  }
};

const startTrustedExtensions = async () => {
  const installed = await readInstalledExtensions();
  for (const extension of installed) {
    if (!extension.enabled || !extension.trusted || !extension.webEntrypoint) continue;
    try {
      await startExtensionHost(extension);
    } catch (error) {
      mainWindow?.webContents.send("extensions:runtime-event", {
        type: "activation-error",
        extensionId: extension.id,
        message: error.message.slice(0, 500),
      });
    }
  }
};

const readRecentWorkspaces = async () => {
  try {
    const contents = await fs.readFile(recentWorkspacesPath(), "utf8");
    const recent = JSON.parse(contents);
    if (!Array.isArray(recent) || recent.some((entry) => typeof entry !== "string")) {
      throw new Error("Recent workspace data is invalid.");
    }
    return recent;
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
};

const activateWorkspace = async (root) => {
  const stat = await fs.stat(root);
  if (!stat.isDirectory()) throw new Error("The selected workspace is not a folder.");

  const tree = await getTree(root, root);
  const recent = [root, ...(await readRecentWorkspaces()).filter((item) => item !== root)].slice(0, 10);
  await fs.writeFile(recentWorkspacesPath(), JSON.stringify(recent, null, 2), "utf8");

  stopWorkspaceWatcher();
  stopTerminal();
  workspaceRoot = root;
  startWorkspaceWatcher(root);
  return { root, name: path.basename(root), tree, recent };
};

const isPathInside = (root, candidate) => {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
};

const getWorkspaceRoot = () => {
  if (!workspaceRoot) throw new Error("Open a workspace before accessing files.");
  return workspaceRoot;
};

const resolveInsideWorkspace = async (relativePath = "") => {
  const root = getWorkspaceRoot();
  const absolutePath = path.resolve(root, relativePath);
  if (!isPathInside(root, absolutePath)) {
    throw new Error("Requested path is outside the open workspace.");
  }

  const canonicalRoot = await fs.realpath(root);
  const missingSegments = [];
  let existingPath = absolutePath;
  let canonicalTarget;
  while (true) {
    try {
      canonicalTarget = await fs.realpath(existingPath);
      break;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      const parent = path.dirname(existingPath);
      if (parent === existingPath) throw error;
      missingSegments.unshift(path.basename(existingPath));
      existingPath = parent;
    }
  }
  canonicalTarget = path.join(canonicalTarget, ...missingSegments);
  if (!isPathInside(canonicalRoot, canonicalTarget)) {
    throw new Error("Requested path is outside the open workspace.");
  }

  return absolutePath;
};

const getTree = async (directory, root, depth = 0) => {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const sorted = entries
    .filter((entry) => entry.name !== "node_modules" && entry.name !== ".git")
    .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));

  return Promise.all(
    sorted.map(async (entry) => {
      const absolutePath = path.join(directory, entry.name);
      const relativePath = path.relative(root, absolutePath);
      const node = {
        name: entry.name,
        path: relativePath,
        type: entry.isDirectory() ? "directory" : "file",
      };

      if (entry.isDirectory() && depth < 6) {
        node.children = await getTree(absolutePath, root, depth + 1);
      }

      return node;
    }),
  );
};

const stopTerminal = () => {
  if (terminalProcess && !terminalProcess.killed) terminalProcess.kill();
  terminalProcess = null;
  terminalSender = null;
};

const walkFiles = async (directory, callback, state) => {
  if (state.entriesVisited >= 10000 || state.results.length >= 500) return;
  const entries = await fs.readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    if (state.entriesVisited >= 10000 || state.results.length >= 500) break;
    state.entriesVisited += 1;
    if (["node_modules", ".git", "dist", "build", "coverage", ".next", "target"].includes(entry.name)) {
      continue;
    }

    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await walkFiles(absolutePath, callback, state);
    } else if (entry.isFile()) {
      await callback(absolutePath);
    }
  }
};

const runGit = async (args, options = {}) => {
  try {
    return await execFileAsync("git", args, {
      cwd: getWorkspaceRoot(),
      windowsHide: true,
      maxBuffer: 2 * 1024 * 1024,
      ...options,
    });
  } catch (error) {
    if (typeof error.stderr === "string" && error.stderr.trim()) {
      throw new Error(error.stderr.trim());
    }
    throw error;
  }
};

const getGitStatus = async () => {
  const { stdout } = await runGit(["status", "--porcelain=v1", "--branch"]);
  const lines = stdout.split(/\r?\n/).filter(Boolean);
  const branch = lines.find((line) => line.startsWith("## "))?.slice(3) ?? "No branch";
  const files = lines
    .filter((line) => !line.startsWith("## "))
    .map((line) => {
      const state = line.slice(0, 2);
      return {
        path: line.slice(3).replace(/^"(.*)"$/, "$1"),
        state,
        staged: state[0] !== " " && state[0] !== "?",
      };
    });
  return { branch, files };
};

const createWindow = () => {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: "#111318",
    title: "Skyline Code",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow = window;
  closeRequestPending = false;
  allowWindowClose = false;
  window.on("close", (event) => {
    if (allowWindowClose || !workspaceDirty) return;
    event.preventDefault();
    if (!closeRequestPending) {
      closeRequestPending = true;
      window.webContents.send("app:close-requested");
    }
  });
  window.on("closed", () => {
    mainWindow = null;
    workspaceDirty = false;
    stopWorkspaceWatcher();
    stopTerminal();
    for (const id of [...extensionHosts.keys()]) stopExtensionHost(id);
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    window.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    window.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }
};

ipcMain.handle("workspace:open", async () => {
  const result = await dialog.showOpenDialog({ properties: ["openDirectory"] });
  if (result.canceled || result.filePaths.length === 0) return null;

  return activateWorkspace(result.filePaths[0]);
});

ipcMain.handle("workspace:recent", async () => readRecentWorkspaces());

ipcMain.handle("workspace:open-recent", async (_event, root) => {
  if (typeof root !== "string") throw new Error("Choose a valid recent workspace.");
  if (!(await readRecentWorkspaces()).includes(root)) {
    throw new Error("That folder is not in the recent workspace list.");
  }
  return activateWorkspace(root);
});

ipcMain.handle("workspace:restore", async () => {
  const recent = await readRecentWorkspaces();
  if (!recent.length) return null;
  return activateWorkspace(recent[0]);
});

ipcMain.handle("workspace:refresh", async () => ({
  tree: await getTree(getWorkspaceRoot(), getWorkspaceRoot()),
}));

ipcMain.handle("extensions:list", async () => readInstalledExtensions());

ipcMain.handle("extensions:commands", async () => [...extensionCommands.values()]);

ipcMain.handle("extensions:search", async (_event, query) => {
  const searchTerm = typeof query === "string" ? query.trim() : "";
  if (!searchTerm) return [];
  if (searchTerm.length > 100) throw new Error("Extension search must be 100 characters or fewer.");
  const url = new URL("https://open-vsx.org/api/-/search");
  url.searchParams.set("query", searchTerm);
  url.searchParams.set("size", "15");
  url.searchParams.set("sortBy", "downloadCount");
  return parseGalleryResults(await fetchRegistryJson(url));
});

ipcMain.handle("extensions:install", (_event, namespace, name, version) => withExtensionOperation(async () => {
  const id = extensionId(namespace, name);
  const packageDirectory = extensionDirectory(extensionsRoot(), namespace, name, version);
  const installed = await readInstalledExtensions();
  const current = installed.find((item) => item.id === id);
  if (current?.version === version) return installed;

  const metadataUrl = new URL(
    `https://open-vsx.org/api/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/${encodeURIComponent(version)}`,
  );
  const metadata = await fetchRegistryJson(metadataUrl);
  const downloadUrl = metadata.files?.download;
  if (typeof downloadUrl !== "string") {
    throw new Error("The extension registry did not provide a package download.");
  }
  const archive = await downloadExtensionArchive(downloadUrl);
  const root = extensionsRoot();
  const temporaryDirectory = `${packageDirectory}.${crypto.randomUUID()}.tmp`;
  let webEntrypoint = null;
  try {
    await fs.mkdir(temporaryDirectory, { recursive: false });
    const extractedRoot = path.join(temporaryDirectory, "package");
    await fs.mkdir(extractedRoot);
    const packageManifest = await extractVsix(archive, extractedRoot);
    if (packageManifest.name.toLowerCase() !== name.toLowerCase() ||
        packageManifest.version !== version) {
      throw new Error("The VSIX manifest does not match the selected extension version.");
    }

    webEntrypoint = resolveSkylineWebExtensionEntry(packageManifest);
    if (webEntrypoint) {
      const entryPath = path.resolve(extractedRoot, webEntrypoint);
      if (!isPathInside(extractedRoot, entryPath)) {
        throw new Error("The Skyline web-extension entry point is outside its package.");
      }
      const entryStat = await fs.stat(entryPath);
      if (!entryStat.isFile() || entryStat.size > 5 * 1024 * 1024) {
        throw new Error("The Skyline web-extension entry point must be a file no larger than 5 MB.");
      }
    }

    const archivePath = path.join(temporaryDirectory, "extension.vsix");
    await fs.writeFile(archivePath, archive, { flag: "wx" });
    await fs.mkdir(root, { recursive: true });
    await fs.rm(packageDirectory, { recursive: true, force: true });
    await fs.rename(temporaryDirectory, packageDirectory);
  } catch (error) {
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
    throw error;
  }

  if (current) stopExtensionHost(id);
  const extension = {
    id,
    namespace,
    name,
    displayName: typeof metadata.displayName === "string" && metadata.displayName
      ? metadata.displayName
      : name,
    description: typeof metadata.description === "string" ? metadata.description : "",
    version,
    publisher: typeof metadata.publishedBy?.displayName === "string"
      ? metadata.publishedBy.displayName
      : namespace,
    installedAt: new Date().toISOString(),
    webEntrypoint,
    enabled: false,
    trusted: false,
  };
  const nextInstalled = [extension, ...installed.filter((item) => item.id !== id)];
  await writeInstalledExtensions(nextInstalled);
  if (current && current.version !== version) {
    const previousDirectory = extensionDirectory(root, namespace, name, current.version);
    await fs.rm(previousDirectory, { recursive: true, force: true });
  }
  return nextInstalled;
}));

ipcMain.handle("extensions:uninstall", (_event, namespace, name) => withExtensionOperation(async () => {
  const id = extensionId(namespace, name);
  const installed = await readInstalledExtensions();
  const extension = installed.find((item) => item.id === id);
  if (!extension) throw new Error("That extension is not installed.");

  stopExtensionHost(id);
  const directory = extensionDirectory(extensionsRoot(), namespace, name, extension.version);
  await fs.rm(directory, { recursive: true, force: false });
  const nextInstalled = installed.filter((item) => item.id !== id);
  await writeInstalledExtensions(nextInstalled);
  return nextInstalled;
}));

ipcMain.handle("extensions:activate", (_event, namespace, name) => withExtensionOperation(async () => {
  const id = extensionId(namespace, name);
  const installed = await readInstalledExtensions();
  const extension = installed.find((item) => item.id === id);
  if (!extension) throw new Error("That extension is not installed.");
  if (!extension.webEntrypoint) {
    throw new Error("This package does not contain a compatible Skyline web extension.");
  }

  const enabledExtension = { ...extension, enabled: true, trusted: true };
  const nextInstalled = installed.map((item) => item.id === id ? enabledExtension : item);
  await writeInstalledExtensions(nextInstalled);
  try {
    await startExtensionHost(enabledExtension);
  } catch (error) {
    await writeInstalledExtensions(nextInstalled.map((item) =>
      item.id === id ? { ...item, enabled: false } : item,
    ));
    throw error;
  }
  return nextInstalled;
}));

ipcMain.handle("extensions:disable", (_event, namespace, name) => withExtensionOperation(async () => {
  const id = extensionId(namespace, name);
  const installed = await readInstalledExtensions();
  const extension = installed.find((item) => item.id === id);
  if (!extension) throw new Error("That extension is not installed.");
  stopExtensionHost(id);
  const nextInstalled = installed.map((item) =>
    item.id === id ? { ...item, enabled: false } : item,
  );
  await writeInstalledExtensions(nextInstalled);
  return nextInstalled;
}));

ipcMain.handle("extensions:run-command", (event, id, command) => {
  if (event.sender !== mainWindow?.webContents ||
      typeof id !== "string" || typeof command !== "string") {
    throw new Error("Invalid extension command request.");
  }
  const extensionCommand = extensionCommands.get(extensionCommandKey(id, command));
  const host = extensionHosts.get(id);
  if (!extensionCommand || !host?.started) throw new Error("That extension command is not active.");
  host.window.webContents.send("extension-host:command", { command });
  return { running: true };
});

ipcMain.handle("file:read", async (_event, relativePath) => {
  const filePath = await resolveInsideWorkspace(relativePath);
  const stat = await fs.stat(filePath);
  if (!stat.isFile()) throw new Error("The selected path is not a file.");
  const contents = await fs.readFile(filePath);
  return { content: contents.toString("utf8"), modifiedAt: stat.mtimeMs, version: getFileVersion(contents) };
});

ipcMain.handle("file:save", async (_event, relativePath, content, expectedVersion) => {
  if (typeof content !== "string" || typeof expectedVersion !== "string") {
    throw new Error("Invalid file save request.");
  }
  const filePath = await resolveInsideWorkspace(relativePath);
  const currentContents = await fs.readFile(filePath);
  assertExpectedFileVersion(currentContents, expectedVersion);
  await fs.writeFile(filePath, content, "utf8");
  return { modifiedAt: (await fs.stat(filePath)).mtimeMs, version: getFileVersion(content) };
});

const assertActiveWorkspace = (requestedRoot) => {
  const activeRoot = getWorkspaceRoot();
  if (typeof requestedRoot !== "string" ||
      path.relative(activeRoot, path.resolve(requestedRoot)) !== "") {
    throw new Error("The workspace changed before its settings could be accessed.");
  }
  return activeRoot;
};

ipcMain.handle("workspace:get-editor-settings", async (_event, requestedRoot) => {
  assertActiveWorkspace(requestedRoot);
  const settingsPath = await resolveInsideWorkspace(".vscode/settings.json");
  let contents;
  try {
    contents = await fs.readFile(settingsPath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }

  return parseWorkspaceEditorSettings(contents);
});

ipcMain.handle("workspace:set-editor-settings", async (_event, requestedRoot, settings) => {
  assertActiveWorkspace(requestedRoot);
  const settingsDirectory = await resolveInsideWorkspace(".vscode");
  await fs.mkdir(settingsDirectory, { recursive: true });
  const settingsPath = await resolveInsideWorkspace(".vscode/settings.json");
  let contents = "";
  try {
    contents = await fs.readFile(settingsPath, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await fs.writeFile(settingsPath, serializeWorkspaceEditorSettings(contents, settings), "utf8");
  return settings;
});

ipcMain.on("app:dirty-state", (event, dirty) => {
  if (event.sender === mainWindow?.webContents) workspaceDirty = dirty === true;
});

ipcMain.on("extension-host:message", (event, message) => {
  for (const [id, host] of extensionHosts) {
    if (event.sender === host.window.webContents) {
      handleExtensionHostMessage(id, message);
      return;
    }
  }
});

ipcMain.on("app:close-response", (event, shouldClose) => {
  if (event.sender !== mainWindow?.webContents || !closeRequestPending) return;
  closeRequestPending = false;
  if (shouldClose !== true) return;

  workspaceDirty = false;
  allowWindowClose = true;
  mainWindow.close();
});

ipcMain.handle("file:create", async (_event, relativePath, type) => {
  const root = getWorkspaceRoot();
  const filePath = await resolveInsideWorkspace(relativePath);
  if (filePath === root) {
    throw new Error("Choose a valid name inside the workspace.");
  }

  if (type === "directory") {
    await fs.mkdir(filePath, { recursive: false });
  } else {
    await fs.writeFile(filePath, "", { flag: "wx" });
  }

  return { tree: await getTree(root, root) };
});

const searchWorkspace = async (searchTerm, maximumResults = 500) => {
  const query = typeof searchTerm === "string" ? searchTerm.trim() : "";
  if (!query) return [];
  if (query.length > 200) throw new Error("Search text must be 200 characters or fewer.");

  const root = getWorkspaceRoot();
  const lowerQuery = query.toLocaleLowerCase();
  const state = { entriesVisited: 0, results: [] };
  await walkFiles(root, async (filePath) => {
    const stat = await fs.stat(filePath);
    if (stat.size > 1024 * 1024) return;
    const content = await fs.readFile(filePath, "utf8");
    if (content.includes("\u0000")) return;

    const lines = content.split(/\r?\n/);
    for (let index = 0; index < lines.length && state.results.length < maximumResults; index += 1) {
      if (lines[index].toLocaleLowerCase().includes(lowerQuery)) {
        state.results.push({
          path: path.relative(root, filePath),
          line: index + 1,
          preview: lines[index].trim().slice(0, 240),
        });
      }
    }
  }, state);
  return state.results;
};

ipcMain.handle("workspace:search", async (_event, searchTerm) => searchWorkspace(searchTerm));

const resolveAgentFile = async (relativePath) => {
  if (typeof relativePath !== "string" || !relativePath.trim() ||
      relativePath.includes("\0") ||
      path.isAbsolute(relativePath) ||
      relativePath.split(/[\\/]/).some((part) => part === ".." || part === "." || part.includes(":"))) {
    throw new Error("The agent can only access relative paths inside the open workspace.");
  }
  const filePath = await resolveInsideWorkspace(relativePath);
  if (filePath === getWorkspaceRoot()) throw new Error("Choose a workspace file.");
  return filePath;
};

const runAgentReadTool = async (tool) => {
  if (tool.name === "search_workspace") {
    return searchWorkspace(tool.arguments.query, 40);
  }

  const filePath = await resolveAgentFile(tool.arguments.path);
  const stat = await fs.stat(filePath);
  if (!stat.isFile() || stat.size > 256 * 1024) {
    throw new Error("The agent can only read text files up to 256 KB.");
  }
  const contents = await fs.readFile(filePath);
  if (contents.includes(0)) throw new Error("The agent cannot read binary files.");
  return {
    path: path.relative(getWorkspaceRoot(), filePath),
    version: getFileVersion(contents),
    content: contents.toString("utf8").slice(0, 24000),
    truncated: contents.length > 24000,
  };
};

const createAgentEditProposal = async (tool) => {
  const filePath = await resolveAgentFile(tool.arguments.path);
  const stat = await fs.stat(filePath);
  if (!stat.isFile() || stat.size > 256 * 1024) {
    throw new Error("The agent can only edit existing text files up to 256 KB.");
  }
  const original = await fs.readFile(filePath);
  if (original.includes(0) || tool.arguments.content.includes("\u0000")) {
    throw new Error("The agent cannot edit binary files.");
  }
  return {
    path: path.relative(getWorkspaceRoot(), filePath),
    originalContent: original.toString("utf8"),
    content: tool.arguments.content,
    expectedVersion: getFileVersion(original),
  };
};

const requestOllamaAgentResponse = async (model, messages) => {
  let response;
  try {
    response = await fetch("http://127.0.0.1:11434/api/chat", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(120000),
      body: JSON.stringify({ model, messages, tools: agentTools, stream: false }),
    });
  } catch (error) {
    throw new Error(`Could not reach the local Ollama model: ${error.message}`);
  }
  if (!response.ok) throw new Error(`Ollama chat failed (${response.status}).`);
  const result = await response.json();
  if (!result?.message || typeof result.message.content !== "string") {
    throw new Error("Ollama returned an invalid chat response.");
  }
  return result.message;
};

ipcMain.handle("agent:models", async (event) => {
  if (event.sender !== mainWindow?.webContents) throw new Error("Invalid agent model request.");
  return fetchOllamaModels();
});

ipcMain.handle("agent:chat", async (event, model, inputMessages) => {
  if (event.sender !== mainWindow?.webContents || typeof model !== "string") {
    throw new Error("Invalid local agent request.");
  }
  const models = await fetchOllamaModels();
  if (!models.some((item) => item.name === model)) {
    throw new Error("Choose an installed local Ollama model with tool support.");
  }
  const messages = normalizeAgentMessages(inputMessages);
  if (!messages.length) throw new Error("Enter a message for the local agent.");

  for (let step = 0; step < 8; step += 1) {
    const rawAssistant = await requestOllamaAgentResponse(model, messages);
    const assistant = normalizeAgentMessages([{
      role: "assistant",
      content: rawAssistant.content,
      ...(rawAssistant.tool_calls ? { tool_calls: rawAssistant.tool_calls } : {}),
    }])[0];
    messages.push(assistant);
    const calls = assistant.tool_calls ?? [];
    if (!calls.length) return { messages, text: assistant.content, pendingEdit: null };
    if (calls.length > 5) throw new Error("The agent requested too many tools at once.");

    let pendingEdit = null;
    for (const call of calls) {
      const parsed = parseAgentToolCall(call);
      if (parsed.name === "propose_file_edit") {
        if (pendingEdit) {
          messages.push({
            role: "tool",
            tool_name: parsed.name,
            content: JSON.stringify({ error: "Approve one file edit at a time." }),
          });
        } else {
          pendingEdit = await createAgentEditProposal(parsed);
          messages.push({
            role: "tool",
            tool_name: parsed.name,
            content: JSON.stringify({ status: "waiting for user approval" }),
          });
        }
      } else {
        try {
          const result = await runAgentReadTool(parsed);
          messages.push({
            role: "tool",
            tool_name: parsed.name,
            content: JSON.stringify(result),
          });
        } catch (error) {
          messages.push({
            role: "tool",
            tool_name: parsed.name,
            content: JSON.stringify({ error: error.message }),
          });
        }
      }
    }

    if (pendingEdit) {
      return {
        messages,
        text: assistant.content || "Review the proposed file change before it is applied.",
        pendingEdit,
      };
    }
  }
  throw new Error("The agent reached its workspace tool limit. Ask a smaller follow-up.");
});

ipcMain.handle("agent:apply-edit", async (event, relativePath, content, expectedVersion) => {
  if (event.sender !== mainWindow?.webContents ||
      typeof content !== "string" || content.length > 256 * 1024 ||
      content.includes("\u0000") ||
      typeof expectedVersion !== "string") {
    throw new Error("Invalid agent edit approval.");
  }
  const filePath = await resolveAgentFile(relativePath);
  const currentContents = await fs.readFile(filePath);
  assertExpectedFileVersion(currentContents, expectedVersion);
  await fs.writeFile(filePath, content, "utf8");
  return {
    path: path.relative(getWorkspaceRoot(), filePath),
    modifiedAt: (await fs.stat(filePath)).mtimeMs,
    version: getFileVersion(content),
  };
});

ipcMain.handle("git:status", async () => getGitStatus());

ipcMain.handle("git:stage", async (_event, relativePath) => {
  const filePath = await resolveInsideWorkspace(relativePath);
  await runGit(["add", "--", path.relative(getWorkspaceRoot(), filePath)]);
  return getGitStatus();
});

ipcMain.handle("git:unstage", async (_event, relativePath) => {
  const filePath = await resolveInsideWorkspace(relativePath);
  await runGit(["reset", "--", path.relative(getWorkspaceRoot(), filePath)]);
  return getGitStatus();
});

ipcMain.handle("git:commit", async (_event, message) => {
  const commitMessage = typeof message === "string" ? message.trim() : "";
  if (!commitMessage || commitMessage.length > 500) {
    throw new Error("Enter a commit message up to 500 characters.");
  }
  await runGit(["commit", "-m", commitMessage]);
  return getGitStatus();
});

ipcMain.handle("git:diff", async (_event, relativePath, staged) => {
  const filePath = await resolveInsideWorkspace(relativePath);
  const args = ["diff", "--no-ext-diff"];
  if (staged) args.push("--cached");
  args.push("--", path.relative(getWorkspaceRoot(), filePath));
  const { stdout } = await runGit(args);
  return stdout;
});

ipcMain.handle("terminal:start", async (event) => {
  const root = getWorkspaceRoot();
  if (terminalProcess && !terminalProcess.killed) {
    if (terminalSender !== event.sender) {
      stopTerminal();
    } else {
      return { running: true };
    }
  }

  const isWindows = process.platform === "win32";
  const shell = isWindows ? (process.env.ComSpec || "powershell.exe") : (process.env.SHELL || "/bin/sh");
  const args = isWindows && /powershell/i.test(shell)
    ? ["-NoLogo", "-NoProfile", "-NoExit", "-Command", "$OutputEncoding = [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()"]
    : isWindows ? ["/Q"] : [];
  terminalProcess = spawn(shell, args, {
    cwd: root,
    windowsHide: true,
    env: { ...process.env, TERM: "xterm-256color" },
  });
  terminalSender = event.sender;
  terminalProcess.stdout.on("data", (chunk) => event.sender.send("terminal:data", chunk.toString()));
  terminalProcess.stderr.on("data", (chunk) => event.sender.send("terminal:data", chunk.toString()));
  terminalProcess.on("error", (error) => event.sender.send("terminal:data", `\r\n${error.message}\r\n`));
  terminalProcess.on("close", (code) => {
    event.sender.send("terminal:exit", code);
    terminalProcess = null;
    terminalSender = null;
  });
  return { running: true };
});

ipcMain.on("terminal:write", (event, data) => {
  if (event.sender !== terminalSender || !terminalProcess || typeof data !== "string" || data.length > 65536) {
    return;
  }
  const input = process.platform === "win32" ? data.replace(/\r(?!\n)/g, "\r\n") : data;
  terminalProcess.stdin.write(input);
});

ipcMain.on("terminal:stop", (event) => {
  if (event.sender === terminalSender) stopTerminal();
});

app.whenReady().then(() => {
  createWindow();
  startTrustedExtensions().catch((error) => {
    mainWindow?.webContents.send("extensions:runtime-event", {
      type: "activation-error",
      extensionId: "",
      message: `Could not restore trusted extensions: ${error.message}`.slice(0, 500),
    });
  });
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", stopTerminal);
