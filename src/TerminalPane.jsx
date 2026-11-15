import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

export default function TerminalPane({ workspace, onError }) {
  const hostRef = useRef(null);
  const workspaceRoot = workspace?.root;
  const workspaceName = workspace?.name;

  useEffect(() => {
    if (!hostRef.current) return undefined;

    const terminal = new Terminal({
      allowProposedApi: false,
      cursorBlink: true,
      convertEol: true,
      fontFamily: "'Cascadia Code', 'Consolas', monospace",
      fontSize: 12,
      scrollback: 3000,
      theme: {
        background: "#14161b",
        foreground: "#d7d9df",
        cursor: "#8eafff",
        selectionBackground: "#405577",
      },
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(hostRef.current);
    fitAddon.fit();

    const removeDataListener = window.skyline.onTerminalData((data) => terminal.write(data));
    const removeExitListener = window.skyline.onTerminalExit((code) => {
      terminal.writeln(`\r\n[process exited: ${code ?? "terminated"}]`);
    });
    const inputSubscription = terminal.onData((data) => window.skyline.writeTerminal(data));
    const resizeObserver = new ResizeObserver(() => fitAddon.fit());
    resizeObserver.observe(hostRef.current);

    if (workspaceRoot) {
      terminal.writeln(`Skyline Code terminal · ${workspaceName}`);
      window.skyline.startTerminal().catch((error) => {
        onError(`Could not start terminal: ${error.message}`);
      });
    } else {
      terminal.writeln("Open a folder to start a terminal.");
    }

    return () => {
      resizeObserver.disconnect();
      inputSubscription.dispose();
      removeDataListener();
      removeExitListener();
      terminal.dispose();
    };
  }, [workspaceRoot, workspaceName, onError]);

  return <div ref={hostRef} className="terminal-host" />;
}
