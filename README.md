# Skyline Code

Skyline Code ek Windows desktop code-editor starter app hai, jo Electron, React aur Monaco Editor par bana hai.

## Run karna

```powershell
npm install
npm run dev
```

Production renderer build ke liye `npm run build` chalao; uske baad `npm start` se desktop app launch hoga.

## Abhi available

- Folder open karna, file explorer aur file filtering
- Files create karna, tabs mein open/edit karna aur `Ctrl+S` se save karna
- Monaco syntax highlighting, minimap, multiple tabs aur local editor workers
- Workspace text search (line numbers ke saath), integrated shell terminal
- Git status, files stage/unstage, diff dekhna aur commit karna
- Monaco diagnostics/problems panel aur saved editor preferences
- `Ctrl+K` command palette, `Ctrl+Shift+F` search, `Ctrl+\`` terminal
- Unsaved tabs ko close, folder switch ya app exit karte waqt Save / Don't Save / Cancel prompt
- Last workspace restore, recent workspace list aur `Ctrl+W` se tab close
- External file changes par clean tabs auto-reload; edited tabs ke liye reload prompt aur overwrite protection
- Drag/keyboard se sidebar aur bottom panel resize; layout preferences save hoti hain
- User/workspace editor settings (`.vscode/settings.json`) aur editable keyboard shortcuts
- Local AI Agent via Ollama: workspace search/read aur approval ke baad file edits (shell commands execute nahi karta)
- Open VSX se extensions search, VSIX package download, installed-package list aur uninstall
- `npm test`, `npm run test:ui`, `npm run lint`, `npm run typecheck`, aur `npm run check`

Compatible Skyline web extensions ab explicit per-extension trust ke baad isolated Worker mein run ho sakte hain; Node.js, filesystem aur network access available nahi hai. Abhi sirf limited Skyline API (commands aur information messages) supported hai. VS Code extension API compatibility, extension updates, debugger adapters, remote development, full language-server ecosystem aur standalone installer abhi pending hain. Yeh VS Code ka exact clone ya feature-complete replacement nahi hai.

Local AI Agent ke liye Ollama pehle se installed aur running hona chahiye, aur local tool-capable model available hona chahiye. Skyline Code Ollama ya model install/download nahi karta; proposed edits user approval aur file-version check ke baad hi apply hote hain.

## Skyline Code ka roadmap

Maqsad ek reliable, extensible VS Code-style editor banana hai. Feature parity ek hi release ka kaam nahi hai; neeche ke phases ko isi order mein implement aur verify kiya jayega. VS Code ki proprietary implementation copy karna goal nahi hai.

### Phase 1 — Core workbench ko reliable banana

- [x] Unsaved changes par save/discard/cancel, tab close, folder switch aur app close ke dauran data loss se bachav
- [x] Recent workspaces aur last workspace restore
- [x] Workspace/file watcher, clean editor buffer refresh aur dirty file overwrite protection
- [x] Resizable panels, keyboard tab navigation, shortcuts aur accessible resize controls
- [x] User/workspace settings aur editable keybindings
- [x] Automated core workflow integration tests, unit tests, ESLint aur renderer/Electron TypeScript checks

**Exit check:** file edit/save/close/reopen workflow predictable ho; unsaved data chupchaap discard na ho; core UI workflows automated integration tests se verify hon.

### Phase 2 — Extension platform

- [x] Open VSX extension discovery aur VSIX package download/removal
- [x] Skyline web-extension entry point inspection aur per-extension trust/enable/disable
- [x] Isolated Worker host, restricted API, runtime commands aur command palette integration
- Extension updates, workspace trust aur broader extension permissions
- Documented public Skyline extension API aur compatible extensions dhoondhne/install karne ka interface

**Exit check:** extension lifecycle UI se manage ho aur extension failure editor ko crash na kare. VS Code extension compatibility ko explicitly test kiya jayega; bina test ke full compatibility ka wada nahi hai.

### Phase 3 — Language intelligence

- Extension platform ke zariye Language Server Protocol (LSP) client aur server lifecycle
- Autocomplete, hover, go-to-definition, references, rename, code actions aur formatting
- Diagnostics/problems ko editor aur Problems panel mein dikhana
- Language servers ko install, configure aur workspace ke hisaab se manage karna

**Exit check:** kam-se-kam ek language ke liye end-to-end language-server workflow tests ke saath chale; baaki languages extensions se add ki ja saken.

### Phase 4 — Debugging

- Debug Adapter Protocol (DAP) ke zariye debugger integration
- Breakpoints, launch configurations, variables, call stack, stepping aur debug console
- Run/Debug controls, error handling aur supported debugger extensions

**Exit check:** ek supported language/runtime mein sample app ko launch, pause, inspect aur continue kar pana.

### Phase 5 — Roz ke development workflows

- Maujooda Git support ko branches, history, hunk staging, discard/revert aur conflict resolution tak badhana
- Multiple terminal sessions, terminal tabs aur shell selection
- Tasks/build commands, Problems panel se diagnostics par jump, test discovery/run results
- Search ko include/exclude filters aur replace-in-files ke saath behtar banana

**Exit check:** aam edit, test, debug aur source-control workflow ke liye app chhodne ki zaroorat kam ho.

### Phase 6 — Workspace aur remote development

- Multi-root workspaces aur workspace-specific configuration
- Remote/SSH/container development ke liye documented, secure connection model
- Remote extension/language/debug processes aur connection recovery

**Exit check:** local aur supported remote workspace ke beech project kholna, edit karna aur tools chalana documented tareeqe se kaam kare.

### Phase 7 — Release aur maintenance

- Windows installer, code signing, versioning aur auto-update
- User settings/extensions ka backup, migration aur recovery
- Crash/error reporting controls, release checks aur supported upgrade path

**Exit check:** clean Windows machine par install, launch, update aur uninstall reproducibly verify ho.

### Pehla implementation target

Phase 1 ke core flows tests ke saath implement hain. Phase 2 mein Open VSX discovery, package management aur limited trusted Skyline web-extension runtime implement hain; VS Code extension compatibility, workspace trust, updates aur broader API abhi pending hain. Har phase ke features tabhi complete maane jayenge jab unke workflows verify hon—sirf UI controls dikhna completion nahi hai.
