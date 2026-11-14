const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const { spawn } = require("node:child_process");
const { execFile } = require("node:child_process");
const fs = require("node:fs/promises");
const path = require("node:path");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);
let workspaceRoot = null;
let terminalProcess = null;
let terminalSender = null;

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
  let canonicalTarget;
  try {
    canonicalTarget = await fs.realpath(absolutePath);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    canonicalTarget = path.join(await fs.realpath(path.dirname(absolutePath)), path.basename(absolutePath));
  }
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
  window.on("closed", stopTerminal);

  if (process.env.VITE_DEV_SERVER_URL) {
    window.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    window.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }
};

ipcMain.handle("workspace:open", async () => {
  const result = await dialog.showOpenDialog({ properties: ["openDirectory"] });
  if (result.canceled || result.filePaths.length === 0) return null;

  const root = result.filePaths[0];
  stopTerminal();
  workspaceRoot = root;
  return { root, name: path.basename(root), tree: await getTree(root, root) };
});

ipcMain.handle("workspace:refresh", async () => ({
  tree: await getTree(getWorkspaceRoot(), getWorkspaceRoot()),
}));

ipcMain.handle("file:read", async (_event, relativePath) => {
  const filePath = await resolveInsideWorkspace(relativePath);
  const stat = await fs.stat(filePath);
  if (!stat.isFile()) throw new Error("The selected path is not a file.");
  return { content: await fs.readFile(filePath, "utf8"), modifiedAt: stat.mtimeMs };
});

ipcMain.handle("file:save", async (_event, relativePath, content) => {
  const filePath = await resolveInsideWorkspace(relativePath);
  await fs.writeFile(filePath, content, "utf8");
  return { modifiedAt: (await fs.stat(filePath)).mtimeMs };
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

ipcMain.handle("workspace:search", async (_event, searchTerm) => {
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
    for (let index = 0; index < lines.length && state.results.length < 500; index += 1) {
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
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", stopTerminal);
