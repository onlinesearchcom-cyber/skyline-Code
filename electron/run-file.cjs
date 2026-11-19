const path = require("node:path");

const getRunnableFileCommand = (filePath, platform = process.platform) => {
  if (typeof filePath !== "string" || !path.isAbsolute(filePath)) {
    throw new Error("Choose a file inside the open workspace.");
  }

  const extension = path.extname(filePath).toLowerCase();
  if ([".js", ".cjs", ".mjs"].includes(extension)) {
    return { executable: "node", args: [filePath] };
  }
  if (extension === ".py") {
    return { executable: platform === "win32" ? "python" : "python3", args: [filePath] };
  }
  throw new Error("Run is supported for JavaScript and Python files only.");
};

module.exports = { getRunnableFileCommand };
