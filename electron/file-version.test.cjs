const assert = require("node:assert/strict");
const { test } = require("node:test");
const { assertExpectedFileVersion, getFileVersion } = require("./file-version.cjs");

test("file versions are stable for identical bytes", () => {
  assert.equal(getFileVersion(Buffer.from("same")), getFileVersion(Buffer.from("same")));
});

test("saving rejects a file whose on-disk contents changed", () => {
  const expectedVersion = getFileVersion(Buffer.from("original"));
  assert.doesNotThrow(() => assertExpectedFileVersion(Buffer.from("original"), expectedVersion));
  assert.throws(
    () => assertExpectedFileVersion(Buffer.from("external edit"), expectedVersion),
    /changed on disk/,
  );
});
