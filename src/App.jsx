import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import TerminalPane from "./TerminalPane.jsx";
import {
  Activity,
  Bot,
  Braces,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Command,
  FileCode2,
  FilePlus2,
  Files,
  Folder,
  FolderOpen,
  FolderPlus,
  GitBranch,
  Keyboard,
  Play,
  Puzzle,
  Search,
  Settings,
  Sparkles,
  Square,
  X,
} from "lucide-react";

const EditorPane = lazy(() => import("./EditorPane.jsx"));
const defaultEditorSettings = { fontSize: 13, tabSize: 2, minimap: true, wordWrap: false };
const runnableFilePattern = /\.(?:cjs|mjs|js|py)$/i;
const defaultKeybindings = {
  save: "Ctrl+S",
  closeTab: "Ctrl+W",
  openFolder: "Ctrl+O",
  commandPalette: "Ctrl+K",
  search: "Ctrl+Shift+F",
  terminal: "Ctrl+`",
  newFile: "Ctrl+N",
};

const loadKeybindings = () => {
  try {
    const saved = window.localStorage.getItem("skyline.keybindings");
    if (!saved) return defaultKeybindings;
    const parsed = JSON.parse(saved);
    return Object.fromEntries(
      Object.entries(defaultKeybindings).map(([command, shortcut]) => [
        command,
        typeof parsed[command] === "string" ? parsed[command] : shortcut,
      ]),
    );
  } catch (error) {
    console.error("Could not load keybindings.", error);
    return defaultKeybindings;
  }
};

const keybindingMatches = (event, shortcut) => {
  const parts = shortcut.split("+");
  const key = parts.pop();
  const hasControl = parts.includes("Ctrl");
  const hasShift = parts.includes("Shift");
  const hasAlt = parts.includes("Alt");
  const actualKey = event.key.length === 1 ? event.key.toUpperCase() : event.key;
  return hasControl === (event.ctrlKey || event.metaKey) &&
    hasShift === event.shiftKey &&
    hasAlt === event.altKey &&
    key.toUpperCase() === actualKey.toUpperCase();
};

const shortcutFromEvent = (event) => {
  const key = event.key;
  if (["Control", "Shift", "Alt", "Meta"].includes(key)) return null;
  const parts = [];
  if (event.ctrlKey || event.metaKey) parts.push("Ctrl");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  const normalizedKey = key.length === 1 ? key.toUpperCase() : key;
  if (!parts.length && normalizedKey.length === 1) return null;
  parts.push(normalizedKey);
  return parts.join("+");
};

const loadDimension = (key, fallback, min, max) => {
  try {
    const stored = window.localStorage.getItem(key);
    if (stored === null || stored.trim() === "") return fallback;
    const saved = Number(stored);
    return Number.isFinite(saved) ? Math.min(max, Math.max(min, saved)) : fallback;
  } catch (error) {
    console.error(`Could not load ${key}.`, error);
    return fallback;
  }
};

const loadEditorSettings = () => {
  try {
    const saved = window.localStorage.getItem("skyline.editorSettings");
    if (!saved) return defaultEditorSettings;
    const parsed = JSON.parse(saved);
    return {
      fontSize: Number.isInteger(parsed.fontSize) ? Math.min(24, Math.max(10, parsed.fontSize)) : 13,
      tabSize: [2, 4, 8].includes(parsed.tabSize) ? parsed.tabSize : 2,
      minimap: parsed.minimap !== false,
      wordWrap: parsed.wordWrap === true,
    };
  } catch (error) {
    console.error("Could not load editor settings.", error);
    return defaultEditorSettings;
  }
};

const languageFor = (filePath = "") => {
  const extension = filePath.split(".").pop()?.toLowerCase();
  const languages = {
    c: "c",
    cc: "cpp",
    cpp: "cpp",
    css: "css",
    cs: "csharp",
    csharp: "csharp",
    go: "go",
    html: "html",
    java: "java",
    js: "javascript",
    json: "json",
    jsx: "javascript",
    md: "markdown",
    py: "python",
    php: "php",
    rb: "ruby",
    rs: "rust",
    sh: "shell",
    sql: "sql",
    ts: "typescript",
    tsx: "typescript",
    xml: "xml",
    yaml: "yaml",
    yml: "yaml",
  };
  return languages[extension] || "plaintext";
};

const shortName = (filePath) => filePath.split(/[\\/]/).pop();

function TreeNode({ node, depth = 0, onOpen, onCreate, activePath }) {
  const [expanded, setExpanded] = useState(depth < 1);
  const isDirectory = node.type === "directory";

  return (
    <>
      <button
        className={`tree-row ${activePath === node.path ? "selected" : ""}`}
        style={{ paddingLeft: 10 + depth * 14 }}
        onClick={() => (isDirectory ? setExpanded((value) => !value) : onOpen(node))}
        onContextMenu={(event) => {
          event.preventDefault();
          if (isDirectory) onCreate(node);
        }}
        title={isDirectory ? "Right-click to create a file or folder" : node.path}
      >
        {isDirectory ? (
          expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />
        ) : (
          <span className="tree-chevron" />
        )}
        {isDirectory ? (
          expanded ? <FolderOpen size={15} className="folder-icon" /> : <Folder size={15} className="folder-icon" />
        ) : (
          <FileCode2 size={14} className="file-icon" />
        )}
        <span className="tree-label">{node.name}</span>
      </button>
      {isDirectory && expanded &&
        node.children?.map((child) => (
          <TreeNode
            key={child.path}
            node={child}
            depth={depth + 1}
            onOpen={onOpen}
            onCreate={onCreate}
            activePath={activePath}
          />
        ))}
    </>
  );
}

export default function App() {
  const [workspace, setWorkspace] = useState(null);
  const [recentWorkspaces, setRecentWorkspaces] = useState([]);
  const [workspaceEditorSettings, setWorkspaceEditorSettings] = useState(null);
  const [workspaceSettingsLoaded, setWorkspaceSettingsLoaded] = useState(false);
  const [workspaceSettingsDirty, setWorkspaceSettingsDirty] = useState(false);
  const [settingsScope, setSettingsScope] = useState("user");
  const [tabs, setTabs] = useState([]);
  const [activePath, setActivePath] = useState(null);
  const [activeView, setActiveView] = useState("explorer");
  const [bottomPanel, setBottomPanel] = useState("terminal");
  const [panelVisible, setPanelVisible] = useState(true);
  const [searchText, setSearchText] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [extensionSearchText, setExtensionSearchText] = useState("");
  const [extensionResults, setExtensionResults] = useState([]);
  const [installedExtensions, setInstalledExtensions] = useState([]);
  const [extensionCommands, setExtensionCommands] = useState([]);
  const [extensionSearching, setExtensionSearching] = useState(false);
  const [extensionSearchError, setExtensionSearchError] = useState("");
  const [extensionOperation, setExtensionOperation] = useState("");
  const [agentModels, setAgentModels] = useState([]);
  const [agentModel, setAgentModel] = useState("");
  const [agentModelsLoading, setAgentModelsLoading] = useState(false);
  const [agentMessages, setAgentMessages] = useState([]);
  const [agentTranscript, setAgentTranscript] = useState([]);
  const [agentInput, setAgentInput] = useState("");
  const [agentBusy, setAgentBusy] = useState(false);
  const [agentError, setAgentError] = useState("");
  const [pendingAgentEdit, setPendingAgentEdit] = useState(null);
  const [gitState, setGitState] = useState(null);
  const [gitError, setGitError] = useState("");
  const [commitMessage, setCommitMessage] = useState("");
  const [diffOutput, setDiffOutput] = useState("");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("");
  const [revealLine, setRevealLine] = useState(1);
  const [cursor, setCursor] = useState({ line: 1, column: 1 });
  const [problems, setProblems] = useState([]);
  const [runOutput, setRunOutput] = useState("");
  const [runningFile, setRunningFile] = useState(false);
  const [editorSettings, setEditorSettings] = useState(loadEditorSettings);
  const [keybindings, setKeybindings] = useState(loadKeybindings);
  const [capturingKeybinding, setCapturingKeybinding] = useState(null);
  const [sidebarWidth, setSidebarWidth] = useState(() => loadDimension("skyline.sidebarWidth", 248, 180, 480));
  const [panelHeight, setPanelHeight] = useState(() => loadDimension("skyline.panelHeight", 154, 100, 500));
  const [dialog, setDialog] = useState(null);
  const [savePrompt, setSavePrompt] = useState(null);
  const [reloadPrompt, setReloadPrompt] = useState(null);
  const [notice, setNotice] = useState("");
  const tabsRef = useRef(tabs);
  const tabElements = useRef(new Map());
  const savePromptResolver = useRef(null);
  const resizeDrag = useRef(null);
  const workspaceSettingsWrite = useRef(Promise.resolve());
  const workspaceSettingsRevision = useRef(0);
  const agentConversationEnd = useRef(null);

  const activeTab = tabs.find((tab) => tab.path === activePath);
  const workspaceRoot = workspace?.root;
  const activeEditorSettings = settingsScope === "workspace" && workspaceEditorSettings
    ? { ...editorSettings, ...workspaceEditorSettings }
    : editorSettings;
  const dirtyCount = tabs.filter((tab) => tab.dirty).length;
  tabsRef.current = tabs;
  const filteredTree = useMemo(() => {
    if (!workspace || !searchText.trim()) return workspace?.tree ?? [];
    const query = searchText.toLowerCase();
    const filterNodes = (nodes) =>
      nodes.flatMap((node) => {
        const children = node.children ? filterNodes(node.children) : [];
        return node.name.toLowerCase().includes(query) || children.length
          ? [{ ...node, children }]
          : [];
      });
    return filterNodes(workspace.tree);
  }, [workspace, searchText]);

  useEffect(() => {
    let cancelled = false;
    window.skyline.restoreWorkspace()
      .then((result) => {
        if (cancelled || !result) return;
        setWorkspace(result);
        setRecentWorkspaces(result.recent);
      })
      .catch((error) => {
        if (!cancelled) setNotice(`Could not restore workspace: ${error.message}`);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    window.skyline.setDirtyState(dirtyCount > 0 || workspaceSettingsDirty);
  }, [dirtyCount, workspaceSettingsDirty]);

  useEffect(() => window.skyline.onWorkspaceWatchError((message) => {
    setNotice(`Workspace file watching failed: ${message}`);
  }), []);

  useEffect(() => {
    const removeOutputListener = window.skyline.onRunOutput((output) => {
      setRunOutput((current) => current + output);
    });
    const removeExitListener = window.skyline.onRunExit((code) => {
      setRunningFile(false);
      setRunOutput((current) =>
        `${current}\r\n[Process exited with code ${code ?? "unknown"}]\r\n`,
      );
    });
    return () => {
      removeOutputListener();
      removeExitListener();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setWorkspaceSettingsLoaded(!workspaceRoot);
    setWorkspaceEditorSettings(null);
    setWorkspaceSettingsDirty(false);
    if (!workspaceRoot) return undefined;

    window.skyline.getWorkspaceEditorSettings(workspaceRoot)
      .then((settings) => {
        if (!cancelled) setWorkspaceEditorSettings(settings);
      })
      .catch((error) => {
        if (!cancelled) setNotice(`Could not load workspace settings: ${error.message}`);
      })
      .finally(() => {
        if (!cancelled) setWorkspaceSettingsLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceRoot]);

  useEffect(() => {
    try {
      window.localStorage.setItem("skyline.sidebarWidth", String(sidebarWidth));
      window.localStorage.setItem("skyline.panelHeight", String(panelHeight));
    } catch (error) {
      setNotice(`Could not save workbench layout: ${error.message}`);
    }
  }, [sidebarWidth, panelHeight]);

  useEffect(() => {
    const onPointerMove = (event) => {
      const drag = resizeDrag.current;
      if (!drag) return;
      if (drag.type === "sidebar") {
        setSidebarWidth(Math.min(480, Math.max(180, drag.width + event.clientX - drag.startX)));
      } else {
        setPanelHeight(Math.min(500, Math.max(100, drag.height + drag.startY - event.clientY)));
      }
    };
    const onPointerUp = () => {
      resizeDrag.current = null;
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, []);

  useEffect(() => {
    if (!notice) return undefined;
    const timer = window.setTimeout(() => setNotice(""), 3200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    let cancelled = false;
    const removeRuntimeListener = window.skyline.onExtensionRuntimeEvent((message) => {
      if (message.type === "command-register" && message.command && message.title) {
        setExtensionCommands((current) => [
          ...current.filter((item) =>
            item.extensionId !== message.extensionId || item.command !== message.command,
          ),
          {
            extensionId: message.extensionId,
            command: message.command,
            title: message.title,
          },
        ]);
      } else if (message.type === "command-unregister") {
        setExtensionCommands((current) => current.filter((item) =>
          item.extensionId !== message.extensionId || item.command !== message.command,
        ));
      } else if (message.type === "information") {
        setNotice(message.message || "Extension message");
      } else if (message.type === "activation-error" || message.type === "command-error") {
        setExtensionSearchError(message.message || "Extension runtime error.");
      }
    });
    window.skyline.listExtensions()
      .then((extensions) => {
        if (!cancelled) setInstalledExtensions(extensions);
      })
      .catch((error) => {
        if (!cancelled) setExtensionSearchError(`Could not load installed extensions: ${error.message}`);
      });
    window.skyline.listExtensionCommands()
      .then((commands) => {
        if (!cancelled) setExtensionCommands(commands);
      })
      .catch((error) => {
        if (!cancelled) setExtensionSearchError(`Could not load extension commands: ${error.message}`);
      });
    return () => {
      cancelled = true;
      removeRuntimeListener();
    };
  }, []);

  useEffect(() => {
    if (activeView !== "agent") return undefined;
    let cancelled = false;
    setAgentModelsLoading(true);
    setAgentError("");
    window.skyline.getAgentModels()
      .then((models) => {
        if (cancelled) return;
        setAgentModels(models);
        setAgentModel((current) =>
          models.some((model) => model.name === current) ? current : models[0]?.name || "",
        );
        if (!models.length) {
          setAgentError("No local Ollama model with tool support is available.");
        }
      })
      .catch((error) => {
        if (!cancelled) setAgentError(error.message);
      })
      .finally(() => {
        if (!cancelled) setAgentModelsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeView]);

  useEffect(() => {
    setAgentMessages([]);
    setAgentTranscript([]);
    setPendingAgentEdit(null);
    setAgentError("");
  }, [workspaceRoot]);

  useEffect(() => {
    agentConversationEnd.current?.scrollIntoView?.({ block: "end" });
  }, [agentTranscript, pendingAgentEdit]);

  useEffect(() => {
    try {
      window.localStorage.setItem("skyline.editorSettings", JSON.stringify(editorSettings));
    } catch (error) {
      setNotice(`Could not save editor settings: ${error.message}`);
    }
  }, [editorSettings]);

  useEffect(() => {
    try {
      window.localStorage.setItem("skyline.keybindings", JSON.stringify(keybindings));
    } catch (error) {
      setNotice(`Could not save keybindings: ${error.message}`);
    }
  }, [keybindings]);

  useEffect(() => {
    if (activeView !== "search" || !workspaceRoot || !searchQuery.trim()) {
      setSearchResults([]);
      setSearching(false);
      setSearchError("");
      return undefined;
    }

    let cancelled = false;
    setSearching(true);
    setSearchError("");
    const timer = window.setTimeout(() => {
      window.skyline.searchWorkspace(searchQuery)
        .then((results) => {
          if (!cancelled) setSearchResults(results);
        })
        .catch((error) => {
          if (!cancelled) setSearchError(error.message);
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [activeView, searchQuery, workspaceRoot]);

  useEffect(() => {
    if (activeView !== "extensions" || !extensionSearchText.trim()) {
      setExtensionResults([]);
      setExtensionSearching(false);
      setExtensionSearchError("");
      return undefined;
    }

    let cancelled = false;
    setExtensionSearching(true);
    setExtensionSearchError("");
    const timer = window.setTimeout(() => {
      window.skyline.searchExtensions(extensionSearchText)
        .then((results) => {
          if (!cancelled) setExtensionResults(results);
        })
        .catch((error) => {
          if (!cancelled) setExtensionSearchError(`Extension search failed: ${error.message}`);
        })
        .finally(() => {
          if (!cancelled) setExtensionSearching(false);
        });
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [activeView, extensionSearchText]);

  const refreshWorkspace = async () => {
    if (!workspace) return;
    try {
      const root = workspace.root;
      const result = await window.skyline.refreshWorkspace();
      setWorkspace((current) => current?.root === root ? { ...current, tree: result.tree } : current);
    } catch (error) {
      setNotice(`Could not refresh workspace: ${error.message}`);
    }
  };

  useEffect(() => {
    if (!workspaceRoot) return undefined;
    const root = workspaceRoot;
    const removeChangeListener = window.skyline.onWorkspaceChange(async (paths) => {
      try {
        const result = await window.skyline.refreshWorkspace();
        setWorkspace((current) => current?.root === root ? { ...current, tree: result.tree } : current);
      } catch (error) {
        setNotice(`Could not refresh workspace: ${error.message}`);
      }

      const changedPaths = paths.includes("*")
        ? tabsRef.current.map((tab) => tab.path)
        : paths;
      if (!workspaceSettingsDirty && (paths.includes("*") ||
          changedPaths.some((filePath) => filePath.replace(/\\/g, "/").toLowerCase() === ".vscode/settings.json"))) {
        try {
          setWorkspaceEditorSettings(await window.skyline.getWorkspaceEditorSettings(root));
        } catch (error) {
          setNotice(`Could not reload workspace settings: ${error.message}`);
        }
      }
      const changedPathKeys = new Set(changedPaths.map((filePath) => filePath.replace(/\\/g, "/").toLowerCase()));
      const openTabs = tabsRef.current.filter((tab) =>
        changedPathKeys.has(tab.path.replace(/\\/g, "/").toLowerCase()),
      );
      await Promise.all(openTabs.map(async (tab) => {
        try {
          const result = await window.skyline.readFile(tab.path);
          if (result.version === tab.version) return;
          setTabs((current) => current.map((item) => {
            if (item.path !== tab.path) return item;
            if (item.dirty) return { ...item, externalChange: true };
            return {
              ...item,
              content: result.content,
              savedContent: result.content,
              modifiedAt: result.modifiedAt,
              version: result.version,
              externalChange: false,
            };
          }));
        } catch (error) {
          setTabs((current) => current.map((item) =>
            item.path === tab.path ? { ...item, externalChange: true } : item,
          ));
          setNotice(`Could not check ${tab.name} on disk: ${error.message}`);
        }
      }));
    });
    return () => {
      removeChangeListener();
    };
  }, [workspaceRoot, workspaceSettingsDirty]);

  const askToSave = (dirtyTabs, action) => new Promise((resolve) => {
    if (savePromptResolver.current) {
      resolve("cancel");
      return;
    }
    savePromptResolver.current = resolve;
    setSavePrompt({ tabs: dirtyTabs, action });
  });

  const resolveSavePrompt = (choice) => {
    const resolve = savePromptResolver.current;
    savePromptResolver.current = null;
    setSavePrompt(null);
    resolve?.(choice);
  };

  const waitForWorkspaceSettingsSave = async () => {
    try {
      await workspaceSettingsWrite.current;
      return true;
    } catch (error) {
      setNotice(`Could not save workspace settings: ${error.message}`);
      return false;
    }
  };

  const persistTab = async (tab) => {
    const contentToSave = tab.content;
    let result;
    try {
      result = await window.skyline.saveFile(tab.path, contentToSave, tab.version);
    } catch (error) {
      if (error.message.includes("changed on disk")) {
        setTabs((current) => current.map((item) =>
          item.path === tab.path ? { ...item, externalChange: true } : item,
        ));
      }
      throw error;
    }
    setTabs((current) =>
      current.map((item) =>
        item.path === tab.path
          ? {
              ...item,
              savedContent: contentToSave,
              modifiedAt: result.modifiedAt,
              version: result.version,
              dirty: item.content !== contentToSave,
              externalChange: false,
            }
          : item,
      ),
    );
  };

  const persistTabs = async (tabsToSave) => {
    for (const tab of tabsToSave) await persistTab(tab);
  };

  const resolveDirtyTabs = async (dirtyTabs, action) => {
    if (!dirtyTabs.length) return "discard";
    const choice = await askToSave(dirtyTabs, action);
    if (choice !== "save") return choice;
    try {
      await persistTabs(dirtyTabs);
      return "save";
    } catch (error) {
      setNotice(`Could not save changes: ${error.message}`);
      return "cancel";
    }
  };
  const resolveDirtyTabsRef = useRef(resolveDirtyTabs);
  resolveDirtyTabsRef.current = resolveDirtyTabs;

  useEffect(() => window.skyline.onCloseRequest(async () => {
    if (!(await waitForWorkspaceSettingsSave())) {
      window.skyline.respondToCloseRequest(false);
      return;
    }
    const choice = await resolveDirtyTabsRef.current(
      tabsRef.current.filter((tab) => tab.dirty),
      "close Skyline Code",
    );
    window.skyline.respondToCloseRequest(choice !== "cancel");
  }), []);

  const finishWorkspaceOpen = (result) => {
    if (!result) return;
    setWorkspace(result);
    setRecentWorkspaces(result.recent);
    setTabs([]);
    setActivePath(null);
    setSearchText("");
  };

  const openWorkspace = async () => {
    if (!(await waitForWorkspaceSettingsSave())) return;
    const choice = await resolveDirtyTabs(tabsRef.current.filter((tab) => tab.dirty), "open another folder");
    if (choice === "cancel") return;
    try {
      finishWorkspaceOpen(await window.skyline.openWorkspace());
    } catch (error) {
      setNotice(`Could not open folder: ${error.message}`);
    }
  };

  const openRecentWorkspace = async (workspacePath) => {
    if (!(await waitForWorkspaceSettingsSave())) return;
    const choice = await resolveDirtyTabs(tabsRef.current.filter((tab) => tab.dirty), "open another folder");
    if (choice === "cancel") return;
    try {
      finishWorkspaceOpen(await window.skyline.openRecentWorkspace(workspacePath));
    } catch (error) {
      setNotice(`Could not open recent folder: ${error.message}`);
    }
  };

  const openFile = async (node, line = 1) => {
    if (!workspace) return;
    const existing = tabs.find((tab) => tab.path === node.path);
    if (existing) {
      setActivePath(node.path);
      setRevealLine(line);
      return;
    }
    try {
      const result = await window.skyline.readFile(node.path);
      const tab = {
        path: node.path,
        name: node.name,
        content: result.content,
        savedContent: result.content,
        modifiedAt: result.modifiedAt,
        version: result.version,
        language: languageFor(node.path),
        dirty: false,
        externalChange: false,
      };
      setTabs((current) => [...current, tab]);
      setActivePath(node.path);
      setRevealLine(line);
    } catch (error) {
      setNotice(`Could not open file: ${error.message}`);
    }
  };

  const saveActiveFile = async () => {
    if (!workspace || !activeTab || !activeTab.dirty) return;
    try {
      await persistTab(activeTab);
      setNotice(`${activeTab.name} saved`);
    } catch (error) {
      setNotice(`Could not save file: ${error.message}`);
    }
  };

  const runCurrentFile = async () => {
    if (!activeTab || !runnableFilePattern.test(activeTab.path) || runningFile) return;
    setPanelVisible(true);
    setBottomPanel("run");
    setRunOutput(`Running ${activeTab.name}...\r\n`);
    setRunningFile(true);
    try {
      if (activeTab.dirty) await persistTab(activeTab);
      await window.skyline.runFile(activeTab.path);
    } catch (error) {
      setRunningFile(false);
      setRunOutput((current) => `${current}\r\n${error.message}\r\n`);
      setNotice(`Could not run ${activeTab.name}: ${error.message}`);
    }
  };

  const stopRunningFile = () => {
    window.skyline.stopRun();
  };

  const updateContent = (content) => {
    setTabs((current) =>
      current.map((tab) =>
        tab.path === activePath
          ? { ...tab, content: content ?? "", dirty: (content ?? "") !== tab.savedContent }
          : tab,
      ),
    );
  };

  const closeTab = async (path, event) => {
    event?.stopPropagation();
    const tab = tabsRef.current.find((item) => item.path === path);
    if (!tab) return;
    if (tab.dirty) {
      const choice = await resolveDirtyTabs([tab], `close ${tab.name}`);
      if (choice === "cancel") return;
    }
    const nextTabs = tabsRef.current.filter((item) => item.path !== path);
    setTabs(nextTabs);
    if (activePath === path) {
      const previousIndex = tabsRef.current.findIndex((item) => item.path === path) - 1;
      setActivePath(nextTabs[Math.max(previousIndex, 0)]?.path ?? null);
    }
  };

  const focusTab = (path) => {
    setActivePath(path);
    window.requestAnimationFrame(() => tabElements.current.get(path)?.focus());
  };

  useEffect(() => {
    const onKeyDown = (event) => {
      if (capturingKeybinding) {
        event.preventDefault();
        if (event.key === "Escape") {
          setCapturingKeybinding(null);
          return;
        }
        const shortcut = shortcutFromEvent(event);
        if (!shortcut) {
          setNotice("Use a modifier or function key for a shortcut.");
          return;
        }
        const conflict = Object.entries(keybindings).find(
          ([command, assigned]) => command !== capturingKeybinding && assigned === shortcut,
        );
        if (conflict) {
          setNotice(`That shortcut is already assigned to ${conflict[0]}.`);
        } else {
          setKeybindings((current) => ({ ...current, [capturingKeybinding]: shortcut }));
        }
        setCapturingKeybinding(null);
        return;
      }
      if (savePrompt) {
        if (event.key === "Escape") resolveSavePrompt("cancel");
        return;
      }
      if (reloadPrompt) {
        if (event.key === "Escape") setReloadPrompt(null);
        return;
      }
      if (keybindingMatches(event, keybindings.save)) {
        event.preventDefault();
        saveActiveFile();
      }
      if (keybindingMatches(event, keybindings.closeTab) && activePath) {
        event.preventDefault();
        void closeTab(activePath, event);
      }
      if (keybindingMatches(event, keybindings.openFolder)) {
        event.preventDefault();
        openWorkspace();
      }
      if (keybindingMatches(event, keybindings.commandPalette) ||
          ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "p")) {
        event.preventDefault();
        setPaletteOpen(true);
      }
      if (keybindingMatches(event, keybindings.search)) {
        event.preventDefault();
        setActiveView("search");
        setPaletteOpen(false);
      }
      if (keybindingMatches(event, keybindings.terminal)) {
        event.preventDefault();
        setPanelVisible(true);
        setBottomPanel("terminal");
      }
      if (keybindingMatches(event, keybindings.newFile)) {
        event.preventDefault();
        if (workspace) startCreate({ path: "" });
      }
      if (event.key === "Escape") {
        setDialog(null);
        setPaletteOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const startCreate = (parent) => setDialog({ parent, type: "file", name: "" });

  const createEntry = async (event) => {
    event.preventDefault();
    const name = dialog?.name.trim();
    if (!name || !workspace) return;
    const relativePath = dialog.parent.path
      ? `${dialog.parent.path}/${name}`
      : name;
    try {
      const result = await window.skyline.createEntry(
        relativePath,
        dialog.type === "folder" ? "directory" : "file",
      );
      setWorkspace((current) => ({ ...current, tree: result.tree }));
      setDialog(null);
      if (dialog.type === "file") {
        await openFile({ name: shortName(relativePath), path: relativePath, type: "file" });
      }
    } catch (error) {
      setNotice(`Could not create ${dialog.type}: ${error.message}`);
    }
  };

  const refreshGit = async () => {
    try {
      const state = await window.skyline.gitStatus();
      setGitState(state);
      setGitError("");
    } catch (error) {
      setGitState(null);
      setGitError(error.message);
    }
  };

  const updateProblems = (filePath, markers) => {
    setProblems((current) => [
      ...current.filter((problem) => problem.path !== filePath),
      ...markers.map((marker) => ({
        path: filePath,
        line: marker.startLineNumber,
        column: marker.startColumn,
        message: marker.message,
        severity: marker.severity,
      })),
    ]);
  };

  const updateEditorSetting = (key, value) => {
    if (settingsScope === "workspace") {
      const currentSettings = { ...editorSettings, ...workspaceEditorSettings };
      const nextSettings = { ...currentSettings, [key]: value };
      setWorkspaceEditorSettings(nextSettings);
      setWorkspaceSettingsDirty(true);
      const workspaceRoot = workspace?.root;
      if (!workspaceRoot) return;
      const revision = ++workspaceSettingsRevision.current;
      const saveSettings = async () => {
        await window.skyline.setWorkspaceEditorSettings(
          workspaceRoot,
          nextSettings,
        );
      };
      const write = workspaceSettingsWrite.current.then(saveSettings, saveSettings);
      workspaceSettingsWrite.current = write;
      write.then(() => {
        if (revision === workspaceSettingsRevision.current) {
          setWorkspaceSettingsDirty(false);
        }
      }).catch((error) => {
        setNotice(`Could not save workspace settings: ${error.message}`);
      });
    } else {
      setEditorSettings((current) => ({ ...current, [key]: value }));
    }
  };

  const reloadTabFromDisk = async (filePath) => {
    try {
      const result = await window.skyline.readFile(filePath);
      setTabs((current) => current.map((tab) =>
        tab.path === filePath
          ? {
              ...tab,
              content: result.content,
              savedContent: result.content,
              modifiedAt: result.modifiedAt,
              version: result.version,
              dirty: false,
              externalChange: false,
            }
          : tab,
      ));
      setReloadPrompt(null);
      setNotice(`${shortName(filePath)} reloaded from disk`);
    } catch (error) {
      setNotice(`Could not reload file: ${error.message}`);
    }
  };

  const requestReloadTab = (tab) => {
    if (tab.dirty) {
      setReloadPrompt(tab.path);
      return;
    }
    void reloadTabFromDisk(tab.path);
  };

  const openSearchResult = async (result) => {
    await openFile({ name: shortName(result.path), path: result.path, type: "file" }, result.line);
    setActiveView("explorer");
  };

  const stageFile = async (file) => {
    try {
      const state = file.staged
        ? await window.skyline.gitUnstage(file.path)
        : await window.skyline.gitStage(file.path);
      setGitState(state);
      setGitError("");
    } catch (error) {
      setGitError(error.message);
    }
  };

  const showFileDiff = async (file) => {
    try {
      const result = await window.skyline.gitDiff(file.path, file.staged);
      setDiffOutput(result || "No diff available for this file.");
      setBottomPanel("output");
      setPanelVisible(true);
    } catch (error) {
      setGitError(error.message);
    }
  };

  const installExtension = async (extension) => {
    setExtensionOperation(extension.id);
    setExtensionSearchError("");
    try {
      setInstalledExtensions(await window.skyline.installExtension(
        extension.namespace,
        extension.name,
        extension.version,
      ));
      setNotice(`${extension.displayName} package downloaded`);
    } catch (error) {
      setExtensionSearchError(`Could not install ${extension.id}: ${error.message}`);
    } finally {
      setExtensionOperation("");
    }
  };

  const activateExtension = async (extension) => {
    const trusted = window.confirm(
      `Enable ${extension.displayName}? Its code will run in an isolated worker without filesystem, Node.js, or network access.`,
    );
    if (!trusted) return;
    setExtensionOperation(extension.id);
    setExtensionSearchError("");
    try {
      setInstalledExtensions(await window.skyline.activateExtension(extension.namespace, extension.name));
      setNotice(`${extension.displayName} enabled`);
    } catch (error) {
      setExtensionSearchError(`Could not enable ${extension.id}: ${error.message}`);
    } finally {
      setExtensionOperation("");
    }
  };

  const disableExtension = async (extension) => {
    setExtensionOperation(extension.id);
    setExtensionSearchError("");
    try {
      setInstalledExtensions(await window.skyline.disableExtension(extension.namespace, extension.name));
      setExtensionCommands((current) => current.filter((item) => item.extensionId !== extension.id));
      setNotice(`${extension.displayName} disabled`);
    } catch (error) {
      setExtensionSearchError(`Could not disable ${extension.id}: ${error.message}`);
    } finally {
      setExtensionOperation("");
    }
  };

  const uninstallExtension = async (extension) => {
    if (!window.confirm(`Remove the downloaded package for ${extension.displayName}?`)) return;
    setExtensionOperation(extension.id);
    setExtensionSearchError("");
    try {
      setInstalledExtensions(await window.skyline.uninstallExtension(extension.namespace, extension.name));
      setNotice(`${extension.displayName} package removed`);
    } catch (error) {
      setExtensionSearchError(`Could not remove ${extension.id}: ${error.message}`);
    } finally {
      setExtensionOperation("");
    }
  };

  const runAgentTurn = async (messages) => {
    const response = await window.skyline.chatWithAgent(agentModel, messages);
    setAgentMessages(response.messages);
    setPendingAgentEdit(response.pendingEdit);
    const reply = response.text || (response.pendingEdit
      ? "I prepared a file change. Review it before applying."
      : "");
    if (reply) setAgentTranscript((current) => [...current, { role: "assistant", content: reply }]);
  };

  const sendAgentMessage = async (event) => {
    event.preventDefault();
    const prompt = agentInput.trim();
    if (!prompt || agentBusy || pendingAgentEdit) return;
    if (!workspaceRoot) {
      setAgentError("Open a workspace before starting an agent conversation.");
      return;
    }
    if (!agentModel) {
      setAgentError("No tool-capable local Ollama model is available.");
      return;
    }

    const messages = agentMessages.length
      ? agentMessages
      : [{
          role: "system",
          content: [
            "You are Skyline Code's local coding agent.",
            "Use search_workspace and read_workspace_file to inspect the open workspace.",
            "For file changes, call propose_file_edit with the complete replacement content.",
            "A proposed edit is not applied until the user approves it in the editor.",
            "Do not run shell commands, access files outside the workspace, or claim an edit was applied before approval.",
            `Current workspace: ${workspace?.name || "unknown"}.`,
          ].join(" "),
        }];
    const userMessage = {
      role: "user",
      content: `${prompt}\n\nCurrent active file: ${activePath || "none"}`,
    };
    setAgentTranscript((current) => [...current, { role: "user", content: prompt }]);
    setAgentInput("");
    setAgentError("");
    setAgentBusy(true);
    try {
      await runAgentTurn([...messages, userMessage]);
    } catch (error) {
      setAgentError(error.message);
    } finally {
      setAgentBusy(false);
    }
  };

  const resolveAgentEdit = async (approve) => {
    if (!pendingAgentEdit || agentBusy) return;
    const proposal = pendingAgentEdit;
    setAgentBusy(true);
    setAgentError("");
    try {
      let toolResult;
      if (approve) {
        const openTab = tabs.find((tab) => tab.path === proposal.path);
        if (openTab?.dirty) {
          throw new Error("Save or discard this file's unsaved editor changes before applying the agent edit.");
        }
        const applied = await window.skyline.applyAgentEdit(
          proposal.path,
          proposal.content,
          proposal.expectedVersion,
        );
        setTabs((current) => current.map((tab) =>
          tab.path === applied.path
            ? {
                ...tab,
                content: proposal.content,
                savedContent: proposal.content,
                modifiedAt: applied.modifiedAt,
                version: applied.version,
                dirty: false,
                externalChange: false,
              }
            : tab,
        ));
        toolResult = { status: "applied", path: applied.path };
        setNotice(`Agent edit applied to ${shortName(applied.path)}`);
      } else {
        toolResult = { status: "rejected", path: proposal.path, message: "The user rejected this edit." };
      }

      const messages = [...agentMessages];
      for (let index = messages.length - 1; index >= 0; index -= 1) {
        if (messages[index].role === "tool" && messages[index].tool_name === "propose_file_edit") {
          messages[index] = {
            ...messages[index],
            content: JSON.stringify(toolResult),
          };
          break;
        }
      }
      setAgentMessages(messages);
      setPendingAgentEdit(null);
      setAgentTranscript((current) => [
        ...current,
        {
          role: "assistant",
          content: approve ? `Applied the proposed edit to ${proposal.path}.` : `Rejected the proposed edit to ${proposal.path}.`,
        },
      ]);
      await runAgentTurn(messages);
    } catch (error) {
      setAgentError(error.message);
    } finally {
      setAgentBusy(false);
    }
  };

  const startNewAgentChat = () => {
    if (agentBusy) return;
    setAgentMessages([]);
    setAgentTranscript([]);
    setPendingAgentEdit(null);
    setAgentInput("");
    setAgentError("");
  };

  const commitChanges = async (event) => {
    event.preventDefault();
    try {
      const state = await window.skyline.gitCommit(commitMessage);
      setGitState(state);
      setCommitMessage("");
      setGitError("");
      setNotice("Git commit created");
    } catch (error) {
      setGitError(error.message);
    }
  };

  const commands = [
    { label: "Open Folder...", shortcut: keybindings.openFolder, action: openWorkspace },
    { label: "Create New File", shortcut: keybindings.newFile, action: () => workspace && startCreate({ path: "" }) },
    { label: "Save Active File", shortcut: keybindings.save, action: saveActiveFile },
    ...(activeTab && runnableFilePattern.test(activeTab.path)
      ? [{ label: "Run Active File", action: runCurrentFile }]
      : []),
    { label: "Close Active Tab", shortcut: keybindings.closeTab, action: () => activePath && closeTab(activePath) },
    { label: "Open Command Palette", shortcut: keybindings.commandPalette, action: () => setPaletteOpen(true) },
    { label: "Toggle Terminal Panel", shortcut: keybindings.terminal, action: () => { setPanelVisible(true); setBottomPanel("terminal"); } },
    { label: "Search in Files", shortcut: keybindings.search, action: () => setActiveView("search") },
    { label: "Show Explorer", action: () => setActiveView("explorer") },
    { label: "Show Source Control", action: () => setActiveView("source") },
    { label: "Show Extensions", action: () => setActiveView("extensions") },
    { label: "Open Local Agent", action: () => setActiveView("agent") },
    { label: "Open Settings", action: () => setActiveView("settings") },
    ...extensionCommands.map((extensionCommand) => ({
      label: extensionCommand.title,
      action: () => window.skyline.runExtensionCommand(
        extensionCommand.extensionId,
        extensionCommand.command,
      ).catch((error) => setExtensionSearchError(`Extension command failed: ${error.message}`)),
    })),
  ].map((command) => ({ shortcut: "", ...command }));
  const filteredCommands = commands.filter((command) =>
    command.label.toLowerCase().includes(paletteQuery.toLowerCase()),
  );
  const runCommand = (command) => {
    setPaletteOpen(false);
    setPaletteQuery("");
    command.action();
  };

  useEffect(() => {
    if (activeView === "source" && workspaceRoot) refreshGit();
  }, [activeView, workspaceRoot]);

  const explorerActions = workspace ? (
    <>
      <button className="icon-button" title="New file" onClick={() => startCreate({ path: "" })}><FilePlus2 size={15} /></button>
      <button className="icon-button" title="New folder" onClick={() => setDialog({ parent: { path: "" }, type: "folder", name: "" })}><FolderPlus size={15} /></button>
      <button className="icon-button" title="Refresh explorer" onClick={refreshWorkspace}><Activity size={15} /></button>
    </>
  ) : null;

  const beginResize = (event, type) => {
    event.preventDefault();
    resizeDrag.current = {
      type,
      startX: event.clientX,
      startY: event.clientY,
      width: sidebarWidth,
      height: panelHeight,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const resizeByKeyboard = (type, event) => {
    const horizontal = type === "sidebar";
    const direction = horizontal
      ? (event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0)
      : (event.key === "ArrowUp" ? 1 : event.key === "ArrowDown" ? -1 : 0);
    if (!direction) return;
    event.preventDefault();
    if (horizontal) {
      setSidebarWidth((value) => Math.min(480, Math.max(180, value + direction * 12)));
    } else {
      setPanelHeight((value) => Math.min(500, Math.max(100, value + direction * 12)));
    }
  };

  /** @type {import("react").CSSProperties & { "--sidebar-width": string }} */
  const workspaceStyle = { "--sidebar-width": `${sidebarWidth}px` };

  return (
    <div className="app-shell">
      <header className="titlebar">
        <div className="brand">
          <div className="brand-mark"><Braces size={16} /></div>
          <span>skyline</span><span className="brand-light">code</span>
        </div>
        <div className="titlebar-center">
          <button className="command-box" onClick={() => setPaletteOpen(true)}><Search size={13} /><span>{workspace?.name ?? "Search commands"}</span><kbd>{keybindings.commandPalette}</kbd></button>
        </div>
        <div className="titlebar-right"><span className="status-dot" /> Ready <span className="title-divider" /><button className="icon-button" title="Settings" onClick={() => setActiveView("settings")}><Settings size={15} /></button></div>
      </header>

      <div className="workspace" style={workspaceStyle}>
        <nav className="activity-bar" aria-label="Activity bar">
          <button className={`activity-button ${activeView === "explorer" ? "active" : ""}`} onClick={() => setActiveView("explorer")} title="Explorer"><Files size={21} /></button>
          <button className={`activity-button ${activeView === "search" ? "active" : ""}`} onClick={() => setActiveView("search")} title="Search"><Search size={21} /></button>
          <button className={`activity-button ${activeView === "source" ? "active" : ""}`} onClick={() => setActiveView("source")} title="Source control"><GitBranch size={21} /></button>
          <button className={`activity-button ${activeView === "extensions" ? "active" : ""}`} onClick={() => setActiveView("extensions")} title="Extensions"><Puzzle size={21} /></button>
          <button className={`activity-button ${activeView === "agent" ? "active" : ""}`} onClick={() => setActiveView("agent")} title="Local AI agent"><Bot size={21} /></button>
          <div className="activity-spacer" />
          <button className="activity-button" onClick={() => setNotice(`Keyboard shortcuts: ${keybindings.openFolder} open folder · ${keybindings.save} save`)} title="Keyboard shortcuts"><Keyboard size={20} /></button>
          <button className="activity-button" onClick={() => setNotice(`Skyline Code · Help: ${keybindings.commandPalette} opens commands, ${keybindings.search} searches files.`)} title="Help"><CircleHelp size={20} /></button>
          <button className={`activity-button ${activeView === "settings" ? "active" : ""}`} onClick={() => setActiveView("settings")} title="Settings"><Settings size={20} /></button>
        </nav>

        <aside className="sidebar">
          <div className="side-heading"><span>{activeView === "explorer" ? "EXPLORER" : activeView.toUpperCase()}</span><button className="icon-button" title="Command palette" onClick={() => setPaletteOpen(true)}><Command size={14} /></button></div>
          {activeView === "explorer" ? (
            <>
              <div className="project-heading">
                <span>{workspace?.name?.toUpperCase() ?? "NO FOLDER OPEN"}</span>
                {explorerActions}
              </div>
              {workspace ? (
                <div className="tree">
                  <input
                    className="filter-input"
                    value={searchText}
                    onChange={(event) => setSearchText(event.target.value)}
                    placeholder="Filter files..."
                    aria-label="Filter files"
                  />
                  {filteredTree.length ? filteredTree.map((node) => (
                    <TreeNode key={node.path} node={node} onOpen={openFile} onCreate={startCreate} activePath={activePath} />
                  )) : <p className="empty-note">No matching files</p>}
                </div>
              ) : (
                <div className="empty-sidebar">
                  <FolderOpen size={28} />
                  <p>Open a folder to start building.</p>
                  <button className="primary-button" onClick={openWorkspace}>Open folder</button>
                  {recentWorkspaces.length > 0 && (
                    <div className="recent-workspaces">
                      <p className="subtle-copy">Recent workspaces</p>
                      {recentWorkspaces.map((root) => (
                        <button className="text-button" key={root} onClick={() => openRecentWorkspace(root)}>
                          {root.split(/[\\/]/).pop() || root}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          ) : activeView === "search" ? (
            <div className="sidebar-content search-sidebar">
              <p className="subtle-copy">Search in files</p>
              <input
                className="filter-input"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search in workspace..."
                maxLength={200}
                disabled={!workspace}
              />
              {searching && <p className="empty-note">Searching...</p>}
              {searchError && <p className="error-note">{searchError}</p>}
              {searchResults.map((result, index) => (
                <button className="search-result" key={`${result.path}-${result.line}-${index}`} onClick={() => openSearchResult(result)}>
                  <span className="search-result-file">{result.path}:{result.line}</span>
                  <span className="search-result-preview">{result.preview || "(empty line)"}</span>
                </button>
              ))}
              {workspace && searchQuery && !searching && !searchResults.length && !searchError &&
                <p className="empty-note">No matching text found.</p>}
            </div>
          ) : activeView === "extensions" ? (
            <div className="sidebar-content extensions-sidebar">
              <p className="subtle-copy">Browse extensions on Open VSX</p>
              <input
                className="filter-input"
                value={extensionSearchText}
                onChange={(event) => setExtensionSearchText(event.target.value)}
                placeholder="Search extensions..."
                maxLength={100}
                aria-label="Search extensions"
              />
              <p className="extension-runtime-note">
                Only packages with a Skyline web-extension entry point can run; this is not full VS Code extension compatibility.
              </p>
              {extensionSearchError && <p className="error-note">{extensionSearchError}</p>}
              <p className="subtle-copy">Installed packages ({installedExtensions.length})</p>
              {installedExtensions.map((extension) => (
                <article className="extension-card installed-extension" key={extension.id}>
                  <strong>{extension.displayName}</strong>
                  <span className="extension-meta">{extension.id} · v{extension.version}</span>
                  {extension.description && <span className="extension-description">{extension.description}</span>}
                  <span className="extension-meta">
                    {extension.enabled ? "Enabled and trusted" : extension.webEntrypoint ? "Disabled" : "No supported Skyline entry point"}
                  </span>
                  {extension.webEntrypoint && (
                    <button
                      className={extension.enabled ? "text-button" : "primary-button"}
                      disabled={extensionOperation === extension.id}
                      onClick={() => extension.enabled ? disableExtension(extension) : activateExtension(extension)}
                    >
                      {extensionOperation === extension.id
                        ? "Working..."
                        : extension.enabled
                          ? "Disable"
                          : "Trust and enable"}
                    </button>
                  )}
                  <button
                    className="text-button"
                    disabled={extensionOperation === extension.id}
                    onClick={() => uninstallExtension(extension)}
                  >
                    {extensionOperation === extension.id ? "Working..." : "Uninstall package"}
                  </button>
                </article>
              ))}
              {extensionSearching && <p className="empty-note">Searching Open VSX...</p>}
              {extensionResults.map((extension) => {
                const isInstalled = installedExtensions.some((installed) => installed.id === extension.id);
                return (
                  <article className="extension-card" key={`${extension.id}-${extension.version}`}>
                    <strong>{extension.displayName}</strong>
                    <span className="extension-meta">{extension.publisher} · v{extension.version}</span>
                    <span className="extension-description">{extension.description || "No description provided."}</span>
                    <span className="extension-meta">{extension.downloadCount.toLocaleString()} downloads</span>
                    <button
                      className="primary-button"
                      disabled={isInstalled || extensionOperation === extension.id}
                      onClick={() => installExtension(extension)}
                    >
                      {isInstalled ? "Downloaded" : extensionOperation === extension.id ? "Downloading..." : "Download package"}
                    </button>
                  </article>
                );
              })}
              {extensionSearchText && !extensionSearching && !extensionSearchError &&
                extensionResults.length === 0 && <p className="empty-note">No matching extensions found.</p>}
            </div>
          ) : activeView === "agent" ? (
            <section className="sidebar-content agent-sidebar">
              <div className="agent-toolbar">
                <select
                  aria-label="Local AI model"
                  value={agentModel}
                  onChange={(event) => setAgentModel(event.target.value)}
                  disabled={agentModelsLoading || !agentModels.length}
                >
                  {agentModelsLoading && <option value="">Loading local models...</option>}
                  {!agentModelsLoading && !agentModels.length && <option value="">No local model available</option>}
                  {agentModels.map((model) => <option key={model.name} value={model.name}>{model.name}</option>)}
                </select>
                <button className="text-button" type="button" onClick={startNewAgentChat} disabled={agentBusy}>
                  New chat
                </button>
              </div>
              <p className="agent-local-note">Local Ollama · code stays on this device</p>
              {!workspace && <p className="empty-note">Open a workspace to let the agent inspect your code.</p>}
              <div className="agent-transcript" role="log" aria-label="Agent conversation" aria-live="polite">
                {!agentTranscript.length && (
                  <p className="empty-note">Ask about your code. The agent can search and read workspace files; edits always need your approval.</p>
                )}
                {agentTranscript.map((message, index) => (
                  <article className={`agent-message ${message.role}`} key={`${message.role}-${index}`}>
                    <strong>{message.role === "user" ? "You" : "Agent"}</strong>
                    <p>{message.content}</p>
                  </article>
                ))}
                {agentBusy && <p className="empty-note">Agent is working locally...</p>}
                <div ref={agentConversationEnd} />
              </div>
              {pendingAgentEdit && (
                <div className="agent-edit-proposal">
                  <strong>Proposed edit: {pendingAgentEdit.path}</strong>
                  <details>
                    <summary>Review current and proposed file contents</summary>
                    <strong>Current</strong>
                    <pre>{pendingAgentEdit.originalContent}</pre>
                    <strong>Proposed</strong>
                    <pre>{pendingAgentEdit.content}</pre>
                  </details>
                  <div className="agent-edit-actions">
                    <button className="primary-button" disabled={agentBusy} onClick={() => resolveAgentEdit(true)}>
                      Apply change
                    </button>
                    <button className="text-button" disabled={agentBusy} onClick={() => resolveAgentEdit(false)}>
                      Reject
                    </button>
                  </div>
                </div>
              )}
              {agentError && <p className="error-note">{agentError}</p>}
              <form className="agent-composer" onSubmit={sendAgentMessage}>
                <textarea
                  aria-label="Message local agent"
                  value={agentInput}
                  onChange={(event) => setAgentInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      sendAgentMessage(event);
                    }
                  }}
                  placeholder="Ask the local agent..."
                  maxLength={4000}
                  disabled={!workspace || !agentModel || agentBusy || Boolean(pendingAgentEdit)}
                />
                <button
                  className="primary-button"
                  type="submit"
                  disabled={!workspace || !agentModel || !agentInput.trim() || agentBusy || Boolean(pendingAgentEdit)}
                >
                  Send
                </button>
              </form>
            </section>
          ) : activeView === "settings" ? (
            <div className="sidebar-content settings-sidebar">
              <p className="subtle-copy">Editor preferences</p>
              <label className="setting-row">
                <span>Settings scope</span>
                <select value={settingsScope} onChange={(event) => setSettingsScope(event.target.value)}>
                  <option value="user">User</option>
                  <option value="workspace" disabled={!workspace}>Workspace</option>
                </select>
              </label>
              {settingsScope === "workspace" && (
                <p className="subtle-copy">
                  {workspaceSettingsLoaded ? "Saved in .vscode/settings.json." : "Loading workspace settings..."}
                </p>
              )}
              <label className="setting-row">
                <span>Font size</span>
                <input type="number" min="10" max="24" disabled={settingsScope === "workspace" && !workspaceSettingsLoaded} value={activeEditorSettings.fontSize} onChange={(event) => updateEditorSetting("fontSize", Math.min(24, Math.max(10, Number(event.target.value) || 10)))} />
              </label>
              <label className="setting-row">
                <span>Tab size</span>
                <select disabled={settingsScope === "workspace" && !workspaceSettingsLoaded} value={activeEditorSettings.tabSize} onChange={(event) => updateEditorSetting("tabSize", Number(event.target.value))}>
                  <option value="2">2 spaces</option><option value="4">4 spaces</option><option value="8">8 spaces</option>
                </select>
              </label>
              <label className="setting-toggle">
                <input type="checkbox" disabled={settingsScope === "workspace" && !workspaceSettingsLoaded} checked={activeEditorSettings.minimap} onChange={(event) => updateEditorSetting("minimap", event.target.checked)} />
                <span>Show minimap</span>
              </label>
              <label className="setting-toggle">
                <input type="checkbox" disabled={settingsScope === "workspace" && !workspaceSettingsLoaded} checked={activeEditorSettings.wordWrap} onChange={(event) => updateEditorSetting("wordWrap", event.target.checked)} />
                <span>Word wrap</span>
              </label>
              {settingsScope === "user" && <p className="subtle-copy">Preferences are saved on this device.</p>}
              <div className="shortcut-list">
                <p className="subtle-copy">Keyboard shortcuts</p>
                {[
                  ["Save file", "save"],
                  ["Close tab", "closeTab"],
                  ["Open folder", "openFolder"],
                  ["Command palette", "commandPalette"],
                  ["Search in files", "search"],
                  ["Toggle terminal", "terminal"],
                  ["New file", "newFile"],
                ].map(([label, command]) => (
                  <div className="shortcut-row" key={command}>
                    <span>{label}</span>
                    <button className="shortcut-edit" onClick={() => setCapturingKeybinding(command)}>
                      <kbd>{capturingKeybinding === command ? "Press keys..." : keybindings[command]}</kbd>
                    </button>
                  </div>
                ))}
                <button className="text-button" onClick={() => setKeybindings(defaultKeybindings)}>Reset defaults</button>
              </div>
            </div>
          ) : (
            <div className="sidebar-content source-sidebar">
              <div className="source-heading">
                <p className="subtle-copy">{gitState?.branch ?? "Source control"}</p>
                <button className="icon-button" title="Refresh Git status" onClick={refreshGit} disabled={!workspace}><Activity size={14} /></button>
              </div>
              {gitError ? <p className="error-note">{gitError}</p> : null}
              {gitState && (
                <>
                  <form className="commit-form" onSubmit={commitChanges}>
                    <input value={commitMessage} onChange={(event) => setCommitMessage(event.target.value)} placeholder="Commit message" aria-label="Commit message" />
                    <button className="primary-button" disabled={!commitMessage.trim() || !gitState.files.some((file) => file.staged)}>Commit</button>
                  </form>
                  {gitState.files.length === 0 ? <p className="empty-note">Working tree clean.</p> : gitState.files.map((file) => (
                    <div className="git-file-row" key={file.path}>
                      <button className="git-file-name" onClick={() => showFileDiff(file)} title="Show diff">
                        <span className="git-state">{file.state}</span>{file.path}
                      </button>
                      <button className="icon-button" onClick={() => stageFile(file)} title={file.staged ? "Unstage" : "Stage"}>
                        {file.staged ? <X size={13} /> : <FilePlus2 size={13} />}
                      </button>
                    </div>
                  ))}
                </>
              )}
              {workspace && !gitState && !gitError && <p className="empty-note">Loading Git status...</p>}
              {!workspace && <p className="empty-note">Open a Git repository to view changes.</p>}
            </div>
          )}
          <div className="sidebar-bottom"><button className="account-row" onClick={() => setNotice("Skyline Code · Local workspace")}><div className="avatar">S</div><span>Skyline Code</span><Settings size={15} /></button></div>
        </aside>
        <div
          className="resize-handle resize-handle-vertical"
          role="separator"
          aria-label="Resize sidebar"
          aria-orientation="vertical"
          aria-valuemin={180}
          aria-valuemax={480}
          aria-valuenow={sidebarWidth}
          tabIndex={0}
          onPointerDown={(event) => beginResize(event, "sidebar")}
          onKeyDown={(event) => resizeByKeyboard("sidebar", event)}
        />

        <main className="main-area">
          <div className="tabs-bar">
            {tabs.map((tab) => (
              <div
                key={tab.path}
                className={`tab ${activePath === tab.path ? "active" : ""}`}
                role="button"
                aria-label={tab.name}
                aria-pressed={activePath === tab.path}
                tabIndex={activePath === tab.path ? 0 : -1}
                ref={(element) => {
                  if (element) tabElements.current.set(tab.path, element);
                  else tabElements.current.delete(tab.path);
                }}
                onClick={() => setActivePath(tab.path)}
                onKeyDown={(event) => {
                  if (event.target !== event.currentTarget) return;
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setActivePath(tab.path);
                  }
                  if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                    event.preventDefault();
                    const index = tabs.findIndex((item) => item.path === tab.path);
                    const offset = event.key === "ArrowRight" ? 1 : -1;
                    const nextIndex = (index + offset + tabs.length) % tabs.length;
                    focusTab(tabs[nextIndex].path);
                  }
                }}
              >
                <FileCode2 size={14} className="file-icon" /><span>{tab.name}</span>
                {tab.dirty && <span className="dirty-dot" aria-label="Unsaved changes" />}
                <button type="button" className="tab-close" aria-label={`Close ${tab.name}`} onClick={(event) => closeTab(tab.path, event)}><X size={13} /></button>
              </div>
            ))}
            <div className="tab-spacer" />
            {workspace && <button className="icon-button" title="Open another folder" onClick={openWorkspace}><FolderOpen size={15} /></button>}
          </div>

          {activeTab ? (
            <div className="editor-wrap">
              <div className="breadcrumbs"><span>{workspace?.name}</span><ChevronRight size={13} />{activeTab.path.split(/[\\/]/).map((part, index, parts) => <span className="crumb-piece" key={`${part}-${index}`}>{index > 0 && <ChevronRight size={12} />}{part}{index < parts.length - 1 && <span className="crumb-hidden" />}</span>)}<button className="run-file-button" aria-label="Run current file" title="Run current JavaScript or Python file" disabled={!runnableFilePattern.test(activeTab.path)} onClick={runningFile ? stopRunningFile : runCurrentFile}>{runningFile ? <Square size={13} /> : <Play size={13} />}{runningFile ? "Stop" : "Run"}</button></div>
              {activeTab.externalChange && (
                <div className="external-change" role="status">
                  <span>This file changed on disk. Reload it to avoid saving over newer changes.</span>
                  <button className="text-button" onClick={() => requestReloadTab(activeTab)}>Reload from disk</button>
                </div>
              )}
              <Suspense fallback={<div className="editor-loading">Starting editor...</div>}>
                <EditorPane
                  path={activeTab.path}
                  language={activeTab.language}
                  value={activeTab.content}
                  revealLine={revealLine}
                  settings={activeEditorSettings}
                  onCursorChange={setCursor}
                  onValidate={updateProblems}
                  onChange={updateContent}
                />
              </Suspense>
            </div>
          ) : (
            <div className="welcome">
              <div className="welcome-orbit"><div className="welcome-logo"><Braces size={39} /></div><div className="orbit-dot dot-one" /><div className="orbit-dot dot-two" /><div className="orbit-dot dot-three" /></div>
              <h1>Build something <span>brilliant.</span></h1>
              <p>A calm, focused home for your code.</p>
              <div className="welcome-actions">
                <button className="welcome-action" onClick={openWorkspace}><FolderOpen size={17} /><span>Open folder</span><kbd>{keybindings.openFolder}</kbd></button>
                <button className="welcome-action" onClick={() => workspace ? startCreate({ path: "" }) : openWorkspace()}><FilePlus2 size={17} /><span>New file</span><kbd>{keybindings.newFile}</kbd></button>
                <button className="welcome-action" onClick={() => setPaletteOpen(true)}><Command size={17} /><span>Open command palette</span><kbd>{keybindings.commandPalette}</kbd></button>
              </div>
              <div className="welcome-footer"><Sparkles size={14} /> Your ideas, in good company.</div>
            </div>
          )}

          {panelVisible && (
            <>
            <div
              className="resize-handle resize-handle-horizontal"
              role="separator"
              aria-label="Resize bottom panel"
              aria-orientation="horizontal"
              aria-valuemin={100}
              aria-valuemax={500}
              aria-valuenow={panelHeight}
              tabIndex={0}
              onPointerDown={(event) => beginResize(event, "panel")}
              onKeyDown={(event) => resizeByKeyboard("panel", event)}
            />
            <section className="bottom-panel" style={{ height: panelHeight, flexBasis: panelHeight }}>
              <div className="panel-tabs">
                {["PROBLEMS", "OUTPUT", "DEBUG CONSOLE", "RUN", "TERMINAL"].map((item) => (
                  <button key={item} className={bottomPanel === item.toLowerCase().replace(" ", "") || (item === "DEBUG CONSOLE" && bottomPanel === "debug") ? "selected" : ""} onClick={() => setBottomPanel(item.toLowerCase().replace(" ", ""))}>{item}</button>
                ))}
                <div className="tab-spacer" />
                <button className="icon-button" title="Close panel" onClick={() => setPanelVisible(false)}><X size={14} /></button>
              </div>
              <div className="panel-content">
                <div className={`terminal-container ${bottomPanel === "terminal" ? "" : "panel-hidden"}`}>
                  <TerminalPane workspace={workspace} onError={setNotice} />
                </div>
                {bottomPanel === "output" && <pre className="diff-output">{diffOutput || "No output."}</pre>}
                {bottomPanel === "run" && (
                  <div className="run-panel">
                    <div className="run-panel-toolbar">
                      <span>{runningFile ? "Running current file" : "Run output"}</span>
                      {runningFile && <button className="text-button" onClick={stopRunningFile}><Square size={12} /> Stop</button>}
                    </div>
                    <pre className="diff-output">{runOutput || "Run a JavaScript or Python file to see its output here."}</pre>
                  </div>
                )}
                {bottomPanel === "problems" && (
                  <div className="problems-list">
                    {problems.length ? problems.map((problem, index) => (
                      <button key={`${problem.path}-${problem.line}-${index}`} className="problem-row" onClick={() => openFile({ name: shortName(problem.path), path: problem.path }, problem.line)}>
                        <span className={`problem-severity severity-${problem.severity}`}>●</span>
                        <span>{problem.message}</span><span className="problem-location">{shortName(problem.path)}:{problem.line}</span>
                      </button>
                    )) : <span className="subtle-copy">No problems reported by the editor.</span>}
                  </div>
                )}
                {bottomPanel === "debugconsole" && <span className="subtle-copy">No debug session is active.</span>}
              </div>
            </section>
            </>
          )}
          <footer className="statusbar">
            <div className="status-left"><button onClick={() => { setActiveView("source"); if (workspace) refreshGit(); }}><GitBranch size={13} /> {gitState?.branch?.split("...")[0] ?? "No branch"}</button><span><Activity size={13} /> {gitState?.files.length ?? dirtyCount}</span></div>
            <div className="status-right">{activeTab && <><span>Ln {cursor.line}, Col {cursor.column}</span><span>Spaces: {activeEditorSettings.tabSize}</span><span>UTF-8</span><span>{activeTab.language}</span></>}<button onClick={() => setPanelVisible((value) => !value)}>◫</button><span>Skyline Code</span></div>
          </footer>
        </main>
      </div>

      {dialog && (
        <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setDialog(null)}>
          <form className="create-dialog" onSubmit={createEntry}>
            <h2>New {dialog.type}</h2>
            <p>Create inside {dialog.parent.path || workspace?.name}</p>
            <input autoFocus value={dialog.name} onChange={(event) => setDialog((current) => ({ ...current, name: event.target.value }))} placeholder={dialog.type === "file" ? "filename.js" : "folder-name"} />
            <div className="dialog-actions"><button type="button" className="text-button" onClick={() => setDialog(null)}>Cancel</button><button type="submit" className="primary-button" disabled={!dialog.name.trim()}>Create</button></div>
          </form>
        </div>
      )}
      {savePrompt && (
        <div className="modal-backdrop">
          <section className="save-dialog" role="dialog" aria-modal="true" aria-labelledby="save-dialog-title">
            <h2 id="save-dialog-title">Save changes?</h2>
            <p>
              {savePrompt.tabs.length === 1
                ? `Save changes to ${savePrompt.tabs[0].name} before you ${savePrompt.action}?`
                : `Save changes in ${savePrompt.tabs.length} files before you ${savePrompt.action}?`}
            </p>
            <div className="dialog-actions">
              <button type="button" className="primary-button" onClick={() => resolveSavePrompt("save")}>
                Save{savePrompt.tabs.length > 1 ? " All" : ""}
              </button>
              <button type="button" className="text-button" onClick={() => resolveSavePrompt("discard")}>Don't Save</button>
              <button type="button" className="text-button" onClick={() => resolveSavePrompt("cancel")}>Cancel</button>
            </div>
          </section>
        </div>
      )}
      {reloadPrompt && (
        <div className="modal-backdrop">
          <section className="save-dialog" role="dialog" aria-modal="true" aria-labelledby="reload-dialog-title">
            <h2 id="reload-dialog-title">Reload from disk?</h2>
            <p>Reloading {shortName(reloadPrompt)} will discard your unsaved editor changes.</p>
            <div className="dialog-actions">
              <button type="button" className="text-button" onClick={() => setReloadPrompt(null)}>Keep editing</button>
              <button type="button" className="primary-button" onClick={() => reloadTabFromDisk(reloadPrompt)}>Reload</button>
            </div>
          </section>
        </div>
      )}
      {paletteOpen && (
        <div className="palette-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setPaletteOpen(false)}>
          <div className="command-palette">
            <input autoFocus value={paletteQuery} onChange={(event) => setPaletteQuery(event.target.value)} placeholder="Type a command to search..." onKeyDown={(event) => {
              if (event.key === "Enter" && filteredCommands[0]) runCommand(filteredCommands[0]);
              if (event.key === "Escape") setPaletteOpen(false);
            }} />
            <div className="command-list">
              {filteredCommands.map((command) => (
                <button key={command.label} className="command-option" onClick={() => runCommand(command)}>
                  <Command size={14} /><span>{command.label}</span>{command.shortcut && <kbd>{command.shortcut}</kbd>}
                </button>
              ))}
              {!filteredCommands.length && <p className="empty-note">No matching commands.</p>}
            </div>
          </div>
        </div>
      )}
      {notice && <div className="toast">{notice}</div>}
    </div>
  );
}
