const assert = require("node:assert/strict");
const path = require("node:path");
const { test } = require("node:test");
const { getRunnableFileCommand } = require("./run-file.cjs");

test("JavaScript file types run through Node without a shell", () => {
  for (const filePath of ["app.js", "app.cjs", "app.mjs"]) {
    const absolutePath = path.resolve(filePath);
    assert.deepEqual(getRunnableFileCommand(absolutePath), {
      executable: "node",
      args: [absolutePath],
    });
  }
});

test("Python files use the platform's Python launcher", () => {
  const filePath = path.resolve("app.py");
  assert.deepEqual(getRunnableFileCommand(filePath, "win32"), {
    executable: "python",
    args: [filePath],
  });
  assert.deepEqual(getRunnableFileCommand(filePath, "linux"), {
    executable: "python3",
    args: [filePath],
  });
});

test("unsupported extensions and non-absolute paths are rejected", () => {
  assert.throws(() => getRunnableFileCommand("app.js"), /inside the open workspace/);
  assert.throws(() => getRunnableFileCommand(path.resolve("notes.txt")), /JavaScript and Python/);
});
