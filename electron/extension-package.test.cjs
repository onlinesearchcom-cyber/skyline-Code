const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const {
  extractVsix,
  resolveSkylineWebExtensionEntry,
  safeExtensionRelativePath,
  validateExtensionRuntimeMessage,
} = require("./extension-package.cjs");
const {
  createExtensionHostDocument,
  createExtensionWorkerSource,
} = require("./extension-host.cjs");

const crc32 = (buffer) => {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
};

const createZip = (files) => {
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;

  for (const { name, contents } of files) {
    const fileName = Buffer.from(name);
    const data = Buffer.from(contents);
    const checksum = crc32(data);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(data.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(fileName.length, 26);
    localParts.push(localHeader, fileName, data);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(data.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(fileName.length, 28);
    centralHeader.writeUInt32LE(localOffset, 42);
    centralParts.push(centralHeader, fileName);
    localOffset += localHeader.length + fileName.length + data.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...localParts, centralDirectory, end]);
};

test("VSIX paths reject traversal, absolute paths, and Windows path separators", () => {
  assert.throws(() => safeExtensionRelativePath("extension/../../outside.js"), /unsafe path/);
  assert.throws(() => safeExtensionRelativePath("extension\\outside.js"), /unsafe path/);
  assert.throws(() => safeExtensionRelativePath("C:/outside.js"), /unsafe path/);
  assert.equal(safeExtensionRelativePath("extension/dist/extension.js").path, "dist\\extension.js");
  assert.equal(safeExtensionRelativePath("[Content_Types].xml"), null);
});

test("VSIX extraction writes only the extension package and reads its manifest", async () => {
  const destination = await fs.mkdtemp(path.join(os.tmpdir(), "skyline-vsix-test-"));
  const archive = createZip([
    { name: "extension/package.json", contents: JSON.stringify({ name: "formatter", version: "1.2.3" }) },
    { name: "extension/dist/extension.js", contents: "globalThis.skylineExtension = {};" },
    { name: "[Content_Types].xml", contents: "<Types />" },
  ]);
  try {
    const manifest = await extractVsix(archive, destination);
    assert.deepEqual(manifest, { name: "formatter", version: "1.2.3" });
    assert.equal(
      await fs.readFile(path.join(destination, "dist", "extension.js"), "utf8"),
      "globalThis.skylineExtension = {};",
    );
    await assert.rejects(fs.access(path.join(destination, "[Content_Types].xml")));
  } finally {
    await fs.rm(destination, { recursive: true, force: true });
  }
});

test("only safe relative Skyline web-extension entry points are accepted", () => {
  assert.equal(resolveSkylineWebExtensionEntry({
    skyline: { webExtension: "dist/extension.js" },
  }), "dist/extension.js");
  assert.equal(resolveSkylineWebExtensionEntry({
    skyline: { webExtension: "../outside.js" },
  }), null);
  assert.equal(resolveSkylineWebExtensionEntry({ browser: "dist/extension.js" }), null);
});

test("extension-host messages are narrowed and bounded before reaching the workbench", () => {
  assert.deepEqual(validateExtensionRuntimeMessage("publisher.extension", {
    type: "command-register",
    command: "format",
    title: "Format Document",
    extra: "discarded",
  }), {
    type: "command-register",
    extensionId: "publisher.extension",
    command: "format",
    title: "Format Document",
  });
  assert.equal(validateExtensionRuntimeMessage("publisher.extension", {
    type: "command-register",
    command: "../outside",
    title: "Bad command",
  }), null);
  assert.equal(validateExtensionRuntimeMessage("publisher.extension", {
    type: "information",
    message: "x".repeat(501),
  }), null);
});

test("extension workers expose only the narrow Skyline API and block connections", () => {
  const workerSource = createExtensionWorkerSource(
    "globalThis.skylineExtension = { activate(api) { api.window.showInformationMessage('ready'); } };",
  );
  assert.match(workerSource, /registerCommand/);
  assert.match(workerSource, /showInformationMessage/);
  assert.doesNotMatch(workerSource, /require\(|nodeIntegration/);
  assert.match(createExtensionHostDocument(), /connect-src 'none'/);
});
