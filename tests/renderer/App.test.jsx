import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../../src/App.jsx";

vi.mock("../../src/EditorPane.jsx", () => ({
  default: ({ value, onChange }) => (
    <textarea
      aria-label="Editor"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));

vi.mock("../../src/TerminalPane.jsx", () => ({
  default: () => <div data-testid="terminal" />,
}));

const initialWorkspace = {
  root: "C:\\work\\project",
  name: "project",
  recent: ["C:\\work\\project"],
  tree: [{ name: "app.js", path: "app.js", type: "file" }],
};

let closeRequest;
let workspaceChange;
let extensionRuntimeEvent;
let runOutputEvent;
let runExitEvent;
let skyline;

const openFile = async (user) => {
  await user.click(await screen.findByRole("button", { name: "app.js" }));
  return screen.findByRole("textbox", { name: "Editor" });
};

const editFile = async (user, value = "edited") => {
  const editor = await openFile(user);
  await user.clear(editor);
  await user.type(editor, value);
  return editor;
};

const requestAppClose = async () => {
  let request;
  act(() => {
    request = closeRequest();
  });
  const dialog = await screen.findByRole("dialog", { name: "Save changes?" });
  return { dialog, request };
};

beforeEach(() => {
  window.localStorage.clear();
  closeRequest = null;
  workspaceChange = null;
  extensionRuntimeEvent = null;
  runOutputEvent = null;
  runExitEvent = null;

  skyline = {
    restoreWorkspace: vi.fn().mockResolvedValue(initialWorkspace),
    listExtensions: vi.fn().mockResolvedValue([]),
    listExtensionCommands: vi.fn().mockResolvedValue([]),
    searchExtensions: vi.fn().mockResolvedValue([]),
    installExtension: vi.fn().mockResolvedValue([]),
    uninstallExtension: vi.fn().mockResolvedValue([]),
    activateExtension: vi.fn().mockResolvedValue([]),
    disableExtension: vi.fn().mockResolvedValue([]),
    runExtensionCommand: vi.fn().mockResolvedValue({ running: true }),
    getAgentModels: vi.fn().mockResolvedValue([{ name: "llama3.2:latest" }]),
    chatWithAgent: vi.fn().mockResolvedValue({
      messages: [],
      text: "I inspected the workspace.",
      pendingEdit: null,
    }),
    applyAgentEdit: vi.fn().mockResolvedValue({
      path: "app.js",
      modifiedAt: 3,
      version: "version-3",
    }),
    onExtensionRuntimeEvent: vi.fn((callback) => {
      extensionRuntimeEvent = callback;
      return () => {};
    }),
    getWorkspaceEditorSettings: vi.fn().mockResolvedValue(null),
    setWorkspaceEditorSettings: vi.fn().mockResolvedValue({}),
    setDirtyState: vi.fn(),
    onWorkspaceWatchError: vi.fn(() => () => {}),
    onWorkspaceChange: vi.fn((callback) => {
      workspaceChange = callback;
      return () => {};
    }),
    onCloseRequest: vi.fn((callback) => {
      closeRequest = callback;
      return () => {};
    }),
    respondToCloseRequest: vi.fn(),
    refreshWorkspace: vi.fn().mockResolvedValue({ tree: initialWorkspace.tree }),
    readFile: vi.fn().mockResolvedValue({
      content: "original",
      modifiedAt: 1,
      version: "version-1",
    }),
    saveFile: vi.fn().mockResolvedValue({
      modifiedAt: 2,
      version: "version-2",
    }),
    openWorkspace: vi.fn().mockResolvedValue(null),
    openRecentWorkspace: vi.fn(),
    searchWorkspace: vi.fn().mockResolvedValue([]),
    createEntry: vi.fn(),
    gitStatus: vi.fn(),
    gitStage: vi.fn(),
    gitUnstage: vi.fn(),
    gitCommit: vi.fn(),
    gitDiff: vi.fn(),
    runFile: vi.fn().mockResolvedValue({ running: true }),
    stopRun: vi.fn(),
    onRunOutput: vi.fn((callback) => {
      runOutputEvent = callback;
      return () => {};
    }),
    onRunExit: vi.fn((callback) => {
      runExitEvent = callback;
      return () => {};
    }),
    startTerminal: vi.fn().mockResolvedValue({ running: true }),
    writeTerminal: vi.fn(),
    stopTerminal: vi.fn(),
    onTerminalData: vi.fn(() => () => {}),
    onTerminalExit: vi.fn(() => () => {}),
  };
  window.skyline = skyline;
});

afterEach(() => {
  cleanup();
});

describe("unsaved editor changes", () => {
  it("keeps a dirty tab open when closing is cancelled", async () => {
    const user = userEvent.setup();
    render(<App />);
    const editor = await editFile(user);

    await user.click(screen.getByRole("button", { name: "Close app.js" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(await screen.findByRole("textbox", { name: "Editor" })).toHaveValue("edited");
    expect(skyline.saveFile).not.toHaveBeenCalled();
    expect(editor).toBeInTheDocument();
  });

  it("discards edits only after explicit confirmation", async () => {
    const user = userEvent.setup();
    render(<App />);
    await editFile(user);

    await user.click(screen.getByRole("button", { name: "Close app.js" }));
    await user.click(screen.getByRole("button", { name: "Don't Save" }));

    await waitFor(() => expect(screen.queryByRole("textbox", { name: "Editor" })).not.toBeInTheDocument());
    expect(skyline.saveFile).not.toHaveBeenCalled();
  });

  it("saves the captured content before closing the tab", async () => {
    const user = userEvent.setup();
    render(<App />);
    await editFile(user, "saved text");

    await user.click(screen.getByRole("button", { name: "Close app.js" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(skyline.saveFile).toHaveBeenCalledWith(
      "app.js",
      "saved text",
      "version-1",
    ));
    await waitFor(() => expect(screen.queryByRole("textbox", { name: "Editor" })).not.toBeInTheDocument());
  });

  it("does not close a tab or open a folder if saving fails", async () => {
    const user = userEvent.setup();
    skyline.saveFile.mockRejectedValue(new Error("disk is read-only"));
    render(<App />);
    await editFile(user, "unsaved");

    await user.click(screen.getByRole("button", { name: "Open another folder" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("textbox", { name: "Editor" })).toHaveValue("unsaved");
    expect(skyline.openWorkspace).not.toHaveBeenCalled();
    expect(await screen.findByText(/Could not save changes/)).toBeInTheDocument();
  });

  it("blocks application close until the user chooses how to handle edits", async () => {
    const user = userEvent.setup();
    render(<App />);
    await editFile(user, "close safely");

    const firstClose = await requestAppClose();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await firstClose.request;

    expect(skyline.respondToCloseRequest).toHaveBeenCalledWith(false);
    expect(screen.getByRole("textbox", { name: "Editor" })).toHaveValue("close safely");

    const secondClose = await requestAppClose();
    await user.click(screen.getByRole("button", { name: "Don't Save" }));
    await secondClose.request;
    await waitFor(() => expect(skyline.respondToCloseRequest).toHaveBeenCalledWith(true));
  });

  it("reloads clean open tabs when the workspace watcher reports a disk change", async () => {
    const user = userEvent.setup();
    render(<App />);
    await openFile(user);
    skyline.readFile.mockResolvedValue({
      content: "changed externally",
      modifiedAt: 3,
      version: "version-3",
    });

    await act(async () => {
      await workspaceChange(["app.js"]);
    });

    expect(await screen.findByRole("textbox", { name: "Editor" })).toHaveValue("changed externally");
    expect(skyline.refreshWorkspace).toHaveBeenCalled();
  });

  it("warns before replacing a dirty tab with external changes", async () => {
    const user = userEvent.setup();
    render(<App />);
    await editFile(user, "my edits");
    skyline.readFile.mockResolvedValue({
      content: "changed externally",
      modifiedAt: 3,
      version: "version-3",
    });

    await act(async () => {
      await workspaceChange(["app.js"]);
    });

    expect(await screen.findByText(/This file changed on disk/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Reload from disk" }));
    await user.click(screen.getByRole("button", { name: "Reload", exact: true }));
    expect(await screen.findByRole("textbox", { name: "Editor" })).toHaveValue("changed externally");
  });

  it("searches Open VSX and downloads a selected extension package", async () => {
    const user = userEvent.setup();
    const extension = {
      id: "publisher.formatter",
      namespace: "publisher",
      name: "formatter",
      displayName: "Formatter",
      description: "Format source",
      version: "1.2.3",
      publisher: "Publisher",
      downloadCount: 42,
    };
    skyline.searchExtensions.mockResolvedValue([extension]);
    skyline.installExtension.mockResolvedValue([{
      ...extension,
      installedAt: "2026-11-15T00:00:00.000Z",
    }]);
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Extensions" }));
    await user.type(screen.getByRole("textbox", { name: "Search extensions" }), "formatter");
    expect(await screen.findByText("Formatter")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Download package" }));

    await waitFor(() => expect(skyline.installExtension).toHaveBeenCalledWith(
      "publisher",
      "formatter",
      "1.2.3",
    ));
    expect(await screen.findByText(/Only packages with a Skyline web-extension entry point can run/)).toBeInTheDocument();
  });

  it("removes an installed package only after confirmation", async () => {
    const user = userEvent.setup();
    const extension = {
      id: "publisher.formatter",
      namespace: "publisher",
      name: "formatter",
      displayName: "Formatter",
      description: "",
      version: "1.2.3",
      publisher: "Publisher",
    };
    skyline.listExtensions.mockResolvedValue([extension]);
    skyline.uninstallExtension.mockResolvedValue([]);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Extensions" }));
    await user.click(await screen.findByRole("button", { name: "Uninstall package" }));

    expect(skyline.uninstallExtension).toHaveBeenCalledWith("publisher", "formatter");
  });

  it("requires explicit trust before activating an installed extension", async () => {
    const user = userEvent.setup();
    const extension = {
      id: "publisher.formatter",
      namespace: "publisher",
      name: "formatter",
      displayName: "Formatter",
      description: "",
      version: "1.2.3",
      publisher: "Publisher",
      webEntrypoint: "dist/extension.js",
      enabled: false,
    };
    skyline.listExtensions.mockResolvedValue([extension]);
    skyline.activateExtension.mockResolvedValue([{ ...extension, enabled: true }]);
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Extensions" }));
    await user.click(await screen.findByRole("button", { name: "Trust and enable" }));
    expect(skyline.activateExtension).not.toHaveBeenCalled();

    window.confirm.mockReturnValue(true);
    await user.click(screen.getByRole("button", { name: "Trust and enable" }));
    expect(skyline.activateExtension).toHaveBeenCalledWith("publisher", "formatter");
  });

  it("adds registered extension commands to the command palette", async () => {
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(extensionRuntimeEvent).toBeTypeOf("function"));
    act(() => {
      extensionRuntimeEvent({
        type: "command-register",
        extensionId: "publisher.formatter",
        command: "format",
        title: "Format Document",
      });
    });

    await user.keyboard("{Control>}k{/Control}");
    await user.click(await screen.findByRole("button", { name: "Format Document" }));
    expect(skyline.runExtensionCommand).toHaveBeenCalledWith("publisher.formatter", "format");
  });

  it("sends a prompt to an available local model with workspace context", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Local AI agent" }));
    await screen.findByRole("option", { name: "llama3.2:latest" });
    await user.type(screen.getByRole("textbox", { name: "Message local agent" }), "Explain this project");
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByText("I inspected the workspace.")).toBeInTheDocument();
    expect(skyline.chatWithAgent).toHaveBeenCalledWith(
      "llama3.2:latest",
      expect.arrayContaining([
        expect.objectContaining({ role: "user", content: expect.stringContaining("Explain this project") }),
      ]),
    );
  });

  it("requires approval before applying an agent-proposed file edit", async () => {
    const user = userEvent.setup();
    const proposal = {
      path: "app.js",
      originalContent: "original",
      content: "updated",
      expectedVersion: "version-1",
    };
    skyline.chatWithAgent
      .mockResolvedValueOnce({
        messages: [
          { role: "system", content: "system" },
          { role: "user", content: "Update the file" },
          {
            role: "assistant",
            content: "",
            tool_calls: [{
              type: "function",
              function: { name: "propose_file_edit", arguments: { path: "app.js", content: "updated" } },
            }],
          },
          { role: "tool", tool_name: "propose_file_edit", content: '{"status":"waiting for user approval"}' },
        ],
        text: "Review this edit.",
        pendingEdit: proposal,
      })
      .mockResolvedValueOnce({
        messages: [],
        text: "The approved edit is in place.",
        pendingEdit: null,
      });
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Local AI agent" }));
    await user.type(screen.getByRole("textbox", { name: "Message local agent" }), "Update the file");
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText("updated")).toBeInTheDocument();
    expect(skyline.applyAgentEdit).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Apply change" }));
    await waitFor(() => expect(skyline.applyAgentEdit).toHaveBeenCalledWith(
      "app.js",
      "updated",
      "version-1",
    ));
    expect(await screen.findByText("The approved edit is in place.")).toBeInTheDocument();
  });
});

describe("running the active file", () => {
  it("runs a JavaScript file and shows output and the exit status", async () => {
    const user = userEvent.setup();
    render(<App />);
    await openFile(user);

    await user.click(screen.getByRole("button", { name: "Run current file" }));
    await waitFor(() => expect(skyline.runFile).toHaveBeenCalledWith("app.js"));
    expect(await screen.findByText("Running current file")).toBeInTheDocument();

    act(() => runOutputEvent("hello from app"));
    expect(await screen.findByText(/hello from app/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Stop", exact: true }));
    expect(skyline.stopRun).toHaveBeenCalled();
    act(() => runExitEvent(0));
    expect(await screen.findByText(/\[Process exited with code 0\]/)).toBeInTheDocument();
  });

  it("saves unsaved changes before running the file", async () => {
    const user = userEvent.setup();
    render(<App />);
    await editFile(user, "console.log('saved first')");

    await user.click(screen.getByRole("button", { name: "Run current file" }));
    await waitFor(() => expect(skyline.runFile).toHaveBeenCalledWith("app.js"));

    expect(skyline.saveFile).toHaveBeenCalledWith("app.js", "console.log('saved first')", "version-1");
    expect(skyline.saveFile.mock.invocationCallOrder[0]).toBeLessThan(
      skyline.runFile.mock.invocationCallOrder[0],
    );
  });
});
