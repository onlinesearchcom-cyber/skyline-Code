import Editor, { loader } from "@monaco-editor/react";
import { useEffect, useRef } from "react";
import * as monaco from "monaco-editor";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import cssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker";
import htmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker";
import tsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";

self.MonacoEnvironment = {
  getWorker(_moduleId, label) {
    if (label === "json") return new jsonWorker();
    if (label === "css" || label === "scss" || label === "less") return new cssWorker();
    if (label === "html" || label === "handlebars" || label === "razor") return new htmlWorker();
    if (label === "typescript" || label === "javascript") return new tsWorker();
    return new editorWorker();
  },
};

loader.config({ monaco });

export default function EditorPane({
  path,
  language,
  value,
  revealLine,
  settings,
  onChange,
  onCursorChange,
  onValidate,
}) {
  const editorRef = useRef(null);
  const cursorListenerRef = useRef(null);

  const reveal = () => {
    if (!editorRef.current || !revealLine) return;
    editorRef.current.revealLineInCenter(revealLine);
    editorRef.current.setPosition({ lineNumber: revealLine, column: 1 });
    editorRef.current.focus();
  };

  useEffect(reveal, [path, revealLine]);
  useEffect(() => () => cursorListenerRef.current?.dispose(), []);

  return (
    <Editor
      height="100%"
      path={path}
      language={language}
      value={value}
      onChange={onChange}
      onValidate={(markers) => onValidate(path, markers)}
      onMount={(editor) => {
        editorRef.current = editor;
        cursorListenerRef.current = editor.onDidChangeCursorPosition(({ position }) => onCursorChange(position));
        reveal();
      }}
      theme="vs-dark"
      options={{
        automaticLayout: true,
        fontFamily: "'Cascadia Code', 'Consolas', monospace",
        fontSize: settings.fontSize,
        minimap: { enabled: settings.minimap },
        scrollBeyondLastLine: false,
        smoothScrolling: true,
        tabSize: settings.tabSize,
        wordWrap: settings.wordWrap ? "on" : "off",
        padding: { top: 14 },
      }}
    />
  );
}
