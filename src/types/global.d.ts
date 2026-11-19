interface WorkspaceTreeNode {
  name: string;
  path: string;
  type: "directory" | "file";
  children?: WorkspaceTreeNode[];
}

interface SkylineWorkspace {
  root: string;
  name: string;
  tree: WorkspaceTreeNode[];
  recent: string[];
}

interface SkylineEditorSettings {
  fontSize: number;
  tabSize: 2 | 4 | 8;
  minimap: boolean;
  wordWrap: boolean;
}

interface SkylineFile {
  content: string;
  modifiedAt: number;
  version: string;
}

interface SkylineGitFile {
  path: string;
  state: string;
  staged: boolean;
}

interface SkylineExtension {
  id: string;
  namespace: string;
  name: string;
  displayName: string;
  description: string;
  version: string;
  publisher: string;
  enabled?: boolean;
  trusted?: boolean;
  webEntrypoint?: string | null;
  installedAt?: string;
  packagePath?: string;
  downloadCount?: number;
}

interface SkylineExtensionCommand {
  extensionId: string;
  command: string;
  title: string;
}

interface SkylineBridge {
  openWorkspace(): Promise<SkylineWorkspace | null>;
  refreshWorkspace(): Promise<{ tree: WorkspaceTreeNode[] }>;
  recentWorkspaces(): Promise<string[]>;
  openRecentWorkspace(path: string): Promise<SkylineWorkspace>;
  restoreWorkspace(): Promise<SkylineWorkspace | null>;
  listExtensions(): Promise<SkylineExtension[]>;
  listExtensionCommands(): Promise<SkylineExtensionCommand[]>;
  searchExtensions(query: string): Promise<SkylineExtension[]>;
  installExtension(namespace: string, name: string, version: string): Promise<SkylineExtension[]>;
  uninstallExtension(namespace: string, name: string): Promise<SkylineExtension[]>;
  activateExtension(namespace: string, name: string): Promise<SkylineExtension[]>;
  disableExtension(namespace: string, name: string): Promise<SkylineExtension[]>;
  runExtensionCommand(extensionId: string, command: string): Promise<{ running: boolean }>;
  onExtensionRuntimeEvent(callback: (message: SkylineExtensionRuntimeEvent) => void): () => void;
  getAgentModels(): Promise<Array<{ name: string }>>;
  chatWithAgent(model: string, messages: SkylineAgentMessage[]): Promise<{
    messages: SkylineAgentMessage[];
    text: string;
    pendingEdit: SkylineAgentEditProposal | null;
  }>;
  createAgentFile(relativePath: string, content: string): Promise<{
    path: string;
    modifiedAt: number;
    version: string;
  }>;
  applyAgentEdit(relativePath: string, content: string, expectedVersion: string): Promise<{
    path: string;
    modifiedAt: number;
    version: string;
  }>;
  getWorkspaceEditorSettings(root: string): Promise<Partial<SkylineEditorSettings> | null>;
  setWorkspaceEditorSettings(root: string, settings: SkylineEditorSettings): Promise<SkylineEditorSettings>;
  readFile(path: string): Promise<SkylineFile>;
  saveFile(path: string, content: string, expectedVersion: string): Promise<Pick<SkylineFile, "modifiedAt" | "version">>;
  createEntry(path: string, type: "file" | "directory"): Promise<{ tree: WorkspaceTreeNode[] }>;
  searchWorkspace(query: string): Promise<Array<{ path: string; line: number; preview: string }>>;
  gitStatus(): Promise<{ branch: string; files: SkylineGitFile[] }>;
  gitStage(path: string): Promise<{ branch: string; files: SkylineGitFile[] }>;
  gitUnstage(path: string): Promise<{ branch: string; files: SkylineGitFile[] }>;
  gitCommit(message: string): Promise<{ branch: string; files: SkylineGitFile[] }>;
  gitDiff(path: string, staged: boolean): Promise<string>;
  runFile(path: string): Promise<{ running: boolean }>;
  stopRun(): void;
  onRunOutput(callback: (output: string) => void): () => void;
  onRunExit(callback: (code: number | null) => void): () => void;
  startTerminal(): Promise<{ running: boolean }>;
  writeTerminal(data: string): void;
  stopTerminal(): void;
  setDirtyState(dirty: boolean): void;
  respondToCloseRequest(shouldClose: boolean): void;
  onCloseRequest(callback: () => void): () => void;
  onWorkspaceChange(callback: (paths: string[]) => void): () => void;
  onWorkspaceWatchError(callback: (message: string) => void): () => void;
  onTerminalData(callback: (data: string) => void): () => void;
  onTerminalExit(callback: (code: number | null) => void): () => void;
}

interface SkylineExtensionRuntimeEvent {
  type: string;
  extensionId: string;
  command?: string;
  title?: string;
  message?: string;
}

interface SkylineAgentMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_name?: string;
  tool_calls?: Array<{
    id?: string;
    type: "function";
    function: {
      name: string;
      arguments: string | Record<string, unknown>;
    };
  }>;
}

interface SkylineAgentEditProposal {
  kind?: "new-file";
  path: string;
  originalContent: string;
  content: string;
  expectedVersion?: string;
}

interface Window {
  skyline: SkylineBridge;
}

interface WorkerGlobalScope {
  MonacoEnvironment: {
    getWorker(moduleId: string, label: string): Worker;
  };
}
