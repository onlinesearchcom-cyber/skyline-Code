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

Yeh VS Code ka exact clone ya feature-complete replacement nahi hai. Extension marketplace/API, debugger adapters, remote development, language-server ecosystem aur standalone installer abhi implement nahi hue hain.
