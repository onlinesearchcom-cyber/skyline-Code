const fs = require("node:fs/promises");
const path = require("node:path");
const yauzl = require("yauzl");

const maximumEntries = 5000;
const maximumFileSize = 20 * 1024 * 1024;
const maximumExpandedSize = 100 * 1024 * 1024;

const safeExtensionRelativePath = (archivePath) => {
  if (typeof archivePath !== "string" || !archivePath || archivePath.includes("\\") ||
      archivePath.includes("\0") || archivePath.startsWith("/") || /^[a-zA-Z]:/.test(archivePath)) {
    throw new Error("The VSIX archive contains an unsafe path.");
  }
  const isDirectory = archivePath.endsWith("/");
  const parts = archivePath.split("/");
  if (isDirectory) parts.pop();
  if (parts.some((part) => !part || part === "." || part === ".." || part.includes(":"))) {
    throw new Error("The VSIX archive contains an unsafe path.");
  }
  if (parts[0] !== "extension") return null;
  return { path: parts.slice(1).join(path.sep), isDirectory };
};

const openZip = (buffer) => new Promise((resolve, reject) => {
  yauzl.fromBuffer(buffer, { lazyEntries: true, validateEntrySizes: true }, (error, zipFile) => {
    if (error) reject(error);
    else resolve(zipFile);
  });
});

const readEntry = (zipFile, entry) => new Promise((resolve, reject) => {
  zipFile.openReadStream(entry, (error, stream) => {
    if (error) {
      reject(error);
      return;
    }
    const chunks = [];
    stream.on("data", (chunk) => chunks.push(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(Buffer.concat(chunks)));
  });
});

const extractVsix = async (archive, destination) => {
  const zipFile = await openZip(archive);
  const destinations = new Set();
  let entriesVisited = 0;
  let expandedSize = 0;
  let settled = false;

  return new Promise((resolve, reject) => {
    const fail = (error) => {
      if (settled) return;
      settled = true;
      zipFile.close();
      reject(error);
    };

    zipFile.on("error", fail);
    zipFile.on("end", async () => {
      if (settled) return;
      try {
        const manifestPath = path.join(destination, "package.json");
        const manifestContents = await fs.readFile(manifestPath, "utf8");
        const manifest = JSON.parse(manifestContents);
        if (!manifest || typeof manifest !== "object" || Array.isArray(manifest) ||
            typeof manifest.name !== "string" || typeof manifest.version !== "string") {
          throw new Error("The VSIX extension/package.json manifest is invalid.");
        }
        resolve(manifest);
      } catch (error) {
        reject(error);
      }
    });

    zipFile.on("entry", async (entry) => {
      if (settled) return;
      try {
        entriesVisited += 1;
        if (entriesVisited > maximumEntries) throw new Error("The VSIX archive contains too many files.");
        const relative = safeExtensionRelativePath(entry.fileName);
        if (!relative) {
          zipFile.readEntry();
          return;
        }
        const unixMode = (entry.externalFileAttributes >>> 16) & 0xf000;
        if (unixMode === 0xa000) throw new Error("Symbolic links are not allowed in VSIX archives.");
        if (!relative.path) {
          if (!relative.isDirectory) throw new Error("The VSIX package root must be a directory.");
          zipFile.readEntry();
          return;
        }

        const normalized = relative.path.toLowerCase();
        if (destinations.has(normalized)) throw new Error("The VSIX archive contains duplicate paths.");
        destinations.add(normalized);

        const outputPath = path.resolve(destination, relative.path);
        if (!outputPath.startsWith(`${path.resolve(destination)}${path.sep}`)) {
          throw new Error("The VSIX archive contains an unsafe path.");
        }
        if (relative.isDirectory) {
          await fs.mkdir(outputPath, { recursive: true });
        } else {
          if (entry.uncompressedSize > maximumFileSize) {
            throw new Error("A VSIX file exceeds the 20 MB extraction limit.");
          }
          expandedSize += entry.uncompressedSize;
          if (expandedSize > maximumExpandedSize) {
            throw new Error("The VSIX archive exceeds the 100 MB extraction limit.");
          }
          const contents = await readEntry(zipFile, entry);
          await fs.mkdir(path.dirname(outputPath), { recursive: true });
          await fs.writeFile(outputPath, contents, { flag: "wx" });
        }
        zipFile.readEntry();
      } catch (error) {
        fail(error);
      }
    });

    zipFile.readEntry();
  });
};

const resolveSkylineWebExtensionEntry = (manifest) => {
  const entry = manifest?.skyline?.webExtension;
  if (typeof entry !== "string" || !entry.trim() || entry.includes("\\") ||
      entry.includes("\0") || path.posix.isAbsolute(entry) ||
      entry.split("/").some((part) => !part || part === "." || part === "..")) {
    return null;
  }
  return entry;
};

const validateExtensionRuntimeMessage = (extensionId, message) => {
  const commandPattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/;
  const textPattern = /^.{1,500}$/s;
  if (!message || typeof message !== "object" || Array.isArray(message)) return null;

  if (message.type === "command-register" && typeof message.command === "string" &&
      commandPattern.test(message.command) && typeof message.title === "string" &&
      textPattern.test(message.title)) {
    return { type: message.type, extensionId, command: message.command, title: message.title };
  }
  if (message.type === "command-unregister" && typeof message.command === "string" &&
      commandPattern.test(message.command)) {
    return { type: message.type, extensionId, command: message.command };
  }
  if (message.type === "information" && typeof message.message === "string" &&
      textPattern.test(message.message)) {
    return { type: message.type, extensionId, message: message.message };
  }
  if (message.type === "activated") return { type: message.type, extensionId };
  if (message.type === "activation-error" && typeof message.message === "string" &&
      textPattern.test(message.message)) {
    return { type: message.type, extensionId, message: message.message };
  }
  if (message.type === "command-error" && typeof message.command === "string" &&
      commandPattern.test(message.command) && typeof message.message === "string" &&
      textPattern.test(message.message)) {
    return {
      type: message.type,
      extensionId,
      command: message.command,
      message: message.message,
    };
  }
  return null;
};

module.exports = {
  extractVsix,
  resolveSkylineWebExtensionEntry,
  safeExtensionRelativePath,
  validateExtensionRuntimeMessage,
};
