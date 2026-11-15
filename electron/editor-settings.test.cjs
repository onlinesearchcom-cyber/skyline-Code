const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  parseWorkspaceEditorSettings,
  serializeWorkspaceEditorSettings,
} = require("./editor-settings.cjs");

test("workspace settings inherit user values when overrides are absent", () => {
  assert.deepEqual(parseWorkspaceEditorSettings("{}"), {});
});

test("workspace settings map supported VS Code editor options", () => {
  assert.deepEqual(
    parseWorkspaceEditorSettings(JSON.stringify({
      "editor.fontSize": 16,
      "editor.tabSize": 4,
      "editor.minimap": { enabled: false },
      "editor.wordWrap": "on",
    })),
    { fontSize: 16, tabSize: 4, minimap: false, wordWrap: true },
  );
});

test("word-wrap modes are mapped to the editor toggle", () => {
  assert.equal(parseWorkspaceEditorSettings('{"editor.wordWrap":"bounded"}').wordWrap, true);
  assert.equal(parseWorkspaceEditorSettings('{"editor.wordWrap":"off"}').wordWrap, false);
});

test("saving editor settings preserves unrelated workspace settings", () => {
  const contents = JSON.stringify({
    "files.exclude": { "**/.cache": true },
    "editor.minimap": { autohide: true },
  });
  const saved = JSON.parse(serializeWorkspaceEditorSettings(contents, {
    fontSize: 15,
    tabSize: 8,
    minimap: false,
    wordWrap: true,
  }));

  assert.deepEqual(saved["files.exclude"], { "**/.cache": true });
  assert.deepEqual(saved["editor.minimap"], { autohide: true, enabled: false });
  assert.equal(saved["editor.fontSize"], 15);
  assert.equal(saved["editor.tabSize"], 8);
  assert.equal(saved["editor.wordWrap"], "on");
});

test("unsupported workspace editor values fail explicitly", () => {
  assert.throws(() => parseWorkspaceEditorSettings('{"editor.fontSize":99}'), /unsupported editor settings/);
  assert.throws(() => parseWorkspaceEditorSettings('{"editor.minimap":"enabled"}'), /unsupported editor settings/);
  assert.throws(() => parseWorkspaceEditorSettings("{"), SyntaxError);
});
