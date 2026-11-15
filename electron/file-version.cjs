const crypto = require("node:crypto");

const getFileVersion = (content) => crypto.createHash("sha256").update(content).digest("hex");

const assertExpectedFileVersion = (currentContent, expectedVersion) => {
  if (getFileVersion(currentContent) !== expectedVersion) {
    throw new Error("This file changed on disk. Reload it before saving to avoid overwriting newer changes.");
  }
};

module.exports = { assertExpectedFileVersion, getFileVersion };
