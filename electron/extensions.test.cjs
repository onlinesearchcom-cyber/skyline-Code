const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  extensionDirectory,
  extensionId,
  parseGalleryResults,
  validateExtensionDownloadUrl,
} = require("./extensions.cjs");

test("gallery entries are mapped to a limited extension summary", () => {
  assert.deepEqual(parseGalleryResults({
    extensions: [{
      namespace: "publisher",
      name: "formatter",
      version: "1.2.3",
      displayName: "Formatter",
      description: "Format source files",
      downloadCount: 42,
      publishedBy: { displayName: "Publisher" },
      secret: "not exposed",
    }],
  }), [{
    id: "publisher.formatter",
    namespace: "publisher",
    name: "formatter",
    displayName: "Formatter",
    description: "Format source files",
    version: "1.2.3",
    publisher: "Publisher",
    downloadCount: 42,
  }]);
});

test("invalid extension identifiers and package paths are rejected", () => {
  assert.throws(() => extensionId("../outside", "extension"), /Invalid extension identifier/);
  assert.throws(() => extensionDirectory("C:\\extensions", "publisher", "..", "1.0.0"), /Invalid extension identifier/);
  assert.throws(() => extensionDirectory("C:\\extensions", "publisher", "formatter", "../1.0"), /Invalid extension version/);
});

test("extension packages may only be downloaded from Open VSX over HTTPS", () => {
  assert.equal(validateExtensionDownloadUrl("https://open-vsx.org/api/publisher/formatter/file").hostname, "open-vsx.org");
  assert.throws(() => validateExtensionDownloadUrl("http://open-vsx.org/package"), /trusted Open VSX/);
  assert.throws(() => validateExtensionDownloadUrl("https://example.com/package"), /trusted Open VSX/);
});

test("gallery responses with malformed extensions fail explicitly", () => {
  assert.throws(() => parseGalleryResults({}), /invalid response/);
  assert.throws(
    () => parseGalleryResults({ extensions: [{ namespace: "../bad", name: "extension", version: "1" }] }),
    /Invalid extension identifier/,
  );
});
