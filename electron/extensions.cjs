const path = require("node:path");

const extensionId = (namespace, name) => {
  const validPart = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;
  if (typeof namespace !== "string" || !validPart.test(namespace) ||
      typeof name !== "string" || !validPart.test(name)) {
    throw new Error("Invalid extension identifier.");
  }
  return `${namespace}.${name}`;
};

const parseGalleryResults = (payload) => {
  if (!payload || !Array.isArray(payload.extensions)) {
    throw new Error("The extension registry returned an invalid response.");
  }
  return payload.extensions.slice(0, 20).map((item) => {
    const id = extensionId(item.namespace, item.name);
    if (typeof item.version !== "string" || !item.version) {
      throw new Error(`The extension registry returned an invalid version for ${id}.`);
    }
    return {
      id,
      namespace: item.namespace,
      name: item.name,
      displayName: typeof item.displayName === "string" && item.displayName
        ? item.displayName
        : item.name,
      description: typeof item.description === "string" ? item.description : "",
      version: item.version,
      publisher: typeof item.publishedBy?.displayName === "string"
        ? item.publishedBy.displayName
        : item.namespace,
      downloadCount: Number.isFinite(item.downloadCount) ? item.downloadCount : 0,
    };
  });
};

const validateExtensionDownloadUrl = (value) => {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("The extension registry returned an invalid download URL.");
  }
  if (url.protocol !== "https:" || url.hostname !== "open-vsx.org" || url.port) {
    throw new Error("Extension downloads must come from the trusted Open VSX registry.");
  }
  return url;
};

const extensionDirectory = (root, namespace, name, version) => {
  const validPart = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;
  if (typeof namespace !== "string" || !validPart.test(namespace) ||
      typeof name !== "string" || !validPart.test(name)) {
    throw new Error("Invalid extension identifier.");
  }
  if (typeof version !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9.+_-]{0,63}$/.test(version)) {
    throw new Error("Invalid extension version.");
  }
  return path.join(root, `${namespace}.${name}-${version}`);
};

module.exports = {
  extensionDirectory,
  extensionId,
  parseGalleryResults,
  validateExtensionDownloadUrl,
};
