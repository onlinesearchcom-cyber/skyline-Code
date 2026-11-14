import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import TerminalPane from "./TerminalPane.jsx";
import {
  Activity,
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
  Search,
  Settings,
  Sparkles,
  X,
} from "lucide-react";

const EditorPane = lazy(() => import("./EditorPane.jsx"));
const defaultEditorSettings = { fontSize: 13, tabSize: 2, minimap: true, wordWrap: false };

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
  const [gitState, setGitState] = useState(null);
  const [gitError, setGitError] = useState("");
  const [commitMessage, setCommitMessage] = useState("");
  const [diffOutput, setDiffOutput] = useState("");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("");
  const [revealLine, setRevealLine] = useState(1);
  const [cursor, setCursor] = useState({ line: 1, column: 1 });
  const [problems, setProblems] = useState([]);
  const [editorSettings, setEditorSettings] = useState(loadEditorSettings);
  const [dialog, setDialog] = useState(null);
  const [notice, setNotice] = useState("");

  const activeTab = tabs.find((tab) => tab.path === activePath);
  const dirtyCount = tabs.filter((tab) => tab.dirty).length;
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
    if (!notice) return undefined;
    const timer = window.setTimeout(() => setNotice(""), 3200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    try {
      window.localStorage.setItem("skyline.editorSettings", JSON.stringify(editorSettings));
    } catch (error) {
      setNotice(`Could not save editor settings: ${error.message}`);
    }
  }, [editorSettings]);

  useEffect(() => {
    if (activeView !== "search" || !workspace || !searchQuery.trim()) {
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
  }, [activeView, searchQuery, workspace?.root]);

  const refreshWorkspace = async () => {
    if (!workspace) return;
    const result = await window.skyline.refreshWorkspace();
    setWorkspace((current) => ({ ...current, tree: result.tree }));
  };

  const openWorkspace = async () => {
    try {
      const result = await window.skyline.openWorkspace();
      if (result) {
        setWorkspace(result);
        setTabs([]);
        setActivePath(null);
        setSearchText("");
      }
    } catch (error) {
      setNotice(`Could not open folder: ${error.message}`);
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
        language: languageFor(node.path),
        dirty: false,
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
      await window.skyline.saveFile(activeTab.path, activeTab.content);
      setTabs((current) =>
        current.map((tab) =>
          tab.path === activePath ? { ...tab, savedContent: tab.content, dirty: false } : tab,
        ),
      );
      setNotice(`${activeTab.name} saved`);
    } catch (error) {
      setNotice(`Could not save file: ${error.message}`);
    }
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

  const closeTab = (event, path) => {
    event.stopPropagation();
    const tab = tabs.find((item) => item.path === path);
    if (tab?.dirty && !window.confirm(`Discard unsaved changes in ${tab.name}?`)) return;
    const nextTabs = tabs.filter((item) => item.path !== path);
    setTabs(nextTabs);
    if (activePath === path) {
      const previousIndex = tabs.findIndex((item) => item.path === path) - 1;
      setActivePath(nextTabs[Math.max(previousIndex, 0)]?.path ?? null);
    }
  };

  useEffect(() => {
    const onKeyDown = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        saveActiveFile();
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "o") {
        event.preventDefault();
        openWorkspace();
      }
      if ((event.ctrlKey || event.metaKey) && (event.key.toLowerCase() === "k" || (event.shiftKey && event.key.toLowerCase() === "p"))) {
        event.preventDefault();
        setPaletteOpen(true);
      }
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "f") {
        event.preventDefault();
        setActiveView("search");
        setPaletteOpen(false);
      }
      if ((event.ctrlKey || event.metaKey) && event.key === "`") {
        event.preventDefault();
        setPanelVisible(true);
        setBottomPanel("terminal");
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "n") {
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
    setEditorSettings((current) => ({ ...current, [key]: value }));
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
    { label: "Open Folder...", shortcut: "Ctrl+O", action: openWorkspace },
    { label: "Create New File", shortcut: "Ctrl+N", action: () => workspace && startCreate({ path: "" }) },
    { label: "Save Active File", shortcut: "Ctrl+S", action: saveActiveFile },
    { label: "Toggle Terminal Panel", shortcut: "Ctrl+`", action: () => { setPanelVisible(true); setBottomPanel("terminal"); } },
    { label: "Search in Files", shortcut: "Ctrl+Shift+F", action: () => setActiveView("search") },
    { label: "Show Explorer", action: () => setActiveView("explorer") },
    { label: "Show Source Control", action: () => setActiveView("source") },
    { label: "Open Settings", action: () => setActiveView("settings") },
  ];
  const filteredCommands = commands.filter((command) =>
    command.label.toLowerCase().includes(paletteQuery.toLowerCase()),
  );
  const runCommand = (command) => {
    setPaletteOpen(false);
    setPaletteQuery("");
    command.action();
  };

  useEffect(() => {
    if (activeView === "source" && workspace) refreshGit();
  }, [activeView, workspace?.root]);

  const explorerActions = workspace ? (
    <>
      <button className="icon-button" title="New file" onClick={() => startCreate({ path: "" })}><FilePlus2 size={15} /></button>
      <button className="icon-button" title="New folder" onClick={() => setDialog({ parent: { path: "" }, type: "folder", name: "" })}><FolderPlus size={15} /></button>
      <button className="icon-button" title="Refresh explorer" onClick={refreshWorkspace}><Activity size={15} /></button>
    </>
  ) : null;

  return (
    <div className="app-shell">
      <header className="titlebar">
        <div className="brand">
          <div className="brand-mark"><Braces size={16} /></div>
          <span>skyline</span><span className="brand-light">code</span>
        </div>
        <div className="titlebar-center">
          <button className="command-box" onClick={() => setPaletteOpen(true)}><Search size={13} /><span>{workspace?.name ?? "Search commands"}</span><kbd>Ctrl K</kbd></button>
        </div>
        <div className="titlebar-right"><span className="status-dot" /> Ready <span className="title-divider" /><button className="icon-button" title="Settings" onClick={() => setActiveView("settings")}><Settings size={15} /></button></div>
      </header>

      <div className="workspace">
        <nav className="activity-bar" aria-label="Activity bar">
          <button className={`activity-button ${activeView === "explorer" ? "active" : ""}`} onClick={() => setActiveView("explorer")} title="Explorer"><Files size={21} /></button>
          <button className={`activity-button ${activeView === "search" ? "active" : ""}`} onClick={() => setActiveView("search")} title="Search"><Search size={21} /></button>
          <button className={`activity-button ${activeView === "source" ? "active" : ""}`} onClick={() => setActiveView("source")} title="Source control"><GitBranch size={21} /></button>
          <div className="activity-spacer" />
          <button className="activity-button" onClick={() => setNotice("Keyboard shortcuts: Ctrl+O open folder · Ctrl+S save")} title="Keyboard shortcuts"><Keyboard size={20} /></button>
          <button className="activity-button" onClick={() => setNotice("Skyline Code · Help: Ctrl+K opens commands, Ctrl+Shift+F searches files.")} title="Help"><CircleHelp size={20} /></button>
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
                  <button className="text-button" onClick={openWorkspace}>Open a recent project <ChevronRight size={14} /></button>
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
          ) : activeView === "settings" ? (
            <div className="sidebar-content settings-sidebar">
              <p className="subtle-copy">Editor preferences</p>
              <label className="setting-row">
                <span>Font size</span>
                <input type="number" min="10" max="24" value={editorSettings.fontSize} onChange={(event) => updateEditorSetting("fontSize", Math.min(24, Math.max(10, Number(event.target.value) || 10)))} />
              </label>
              <label className="setting-row">
                <span>Tab size</span>
                <select value={editorSettings.tabSize} onChange={(event) => updateEditorSetting("tabSize", Number(event.target.value))}>
                  <option value="2">2 spaces</option><option value="4">4 spaces</option><option value="8">8 spaces</option>
                </select>
              </label>
              <label className="setting-toggle">
                <input type="checkbox" checked={editorSettings.minimap} onChange={(event) => updateEditorSetting("minimap", event.target.checked)} />
                <span>Show minimap</span>
              </label>
              <label className="setting-toggle">
                <input type="checkbox" checked={editorSettings.wordWrap} onChange={(event) => updateEditorSetting("wordWrap", event.target.checked)} />
                <span>Word wrap</span>
              </label>
              <p className="subtle-copy">Preferences are saved on this device.</p>
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

        <main className="main-area">
          <div className="tabs-bar">
            {tabs.map((tab) => (
              <button key={tab.path} className={`tab ${activePath === tab.path ? "active" : ""}`} onClick={() => setActivePath(tab.path)}>
                <FileCode2 size={14} className="file-icon" /><span>{tab.name}</span>
                {tab.dirty ? <span className="dirty-dot" /> : <span className="tab-close" onClick={(event) => closeTab(event, tab.path)}><X size={13} /></span>}
              </button>
            ))}
            <div className="tab-spacer" />
            {workspace && <button className="icon-button" title="Open another folder" onClick={openWorkspace}><FolderOpen size={15} /></button>}
          </div>

          {activeTab ? (
            <div className="editor-wrap">
              <div className="breadcrumbs"><span>{workspace?.name}</span><ChevronRight size={13} />{activeTab.path.split(/[\\/]/).map((part, index, parts) => <span className="crumb-piece" key={`${part}-${index}`}>{index > 0 && <ChevronRight size={12} />}{part}{index < parts.length - 1 && <span className="crumb-hidden" />}</span>)}</div>
              <Suspense fallback={<div className="editor-loading">Starting editor...</div>}>
                <EditorPane
                  path={activeTab.path}
                  language={activeTab.language}
                  value={activeTab.content}
                  revealLine={revealLine}
                  settings={editorSettings}
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
                <button className="welcome-action" onClick={openWorkspace}><FolderOpen size={17} /><span>Open folder</span><kbd>Ctrl O</kbd></button>
                <button className="welcome-action" onClick={() => workspace ? startCreate({ path: "" }) : openWorkspace()}><FilePlus2 size={17} /><span>New file</span><kbd>Ctrl N</kbd></button>
                <button className="welcome-action" onClick={() => setPaletteOpen(true)}><Command size={17} /><span>Open command palette</span><kbd>Ctrl K</kbd></button>
              </div>
              <div className="welcome-footer"><Sparkles size={14} /> Your ideas, in good company.</div>
            </div>
          )}

          {panelVisible && (
            <section className="bottom-panel">
              <div className="panel-tabs">
                {["PROBLEMS", "OUTPUT", "DEBUG CONSOLE", "TERMINAL"].map((item) => (
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
          )}
          <footer className="statusbar">
            <div className="status-left"><button onClick={() => { setActiveView("source"); if (workspace) refreshGit(); }}><GitBranch size={13} /> {gitState?.branch?.split("...")[0] ?? "No branch"}</button><span><Activity size={13} /> {gitState?.files.length ?? dirtyCount}</span></div>
            <div className="status-right">{activeTab && <><span>Ln {cursor.line}, Col {cursor.column}</span><span>Spaces: {editorSettings.tabSize}</span><span>UTF-8</span><span>{activeTab.language}</span></>}<button onClick={() => setPanelVisible((value) => !value)}>◫</button><span>Skyline Code</span></div>
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
