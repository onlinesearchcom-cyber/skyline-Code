const createExtensionWorkerSource = (extensionSource) => `
"use strict";
const extensionSource = ${JSON.stringify(extensionSource)};
const registeredCommands = new Map();
const api = Object.freeze({
  commands: Object.freeze({
    registerCommand(command, title, handler) {
      if (typeof command !== "string" || typeof title !== "string" ||
          typeof handler !== "function" || registeredCommands.has(command)) {
        throw new Error("registerCommand requires a unique command, title, and handler.");
      }
      registeredCommands.set(command, handler);
      self.postMessage({ type: "command-register", command, title });
      return Object.freeze({
        dispose() {
          if (registeredCommands.delete(command)) {
            self.postMessage({ type: "command-unregister", command });
          }
        },
      });
    },
  }),
  window: Object.freeze({
    showInformationMessage(message) {
      if (typeof message !== "string") throw new Error("Messages must be text.");
      self.postMessage({ type: "information", message });
      return Promise.resolve(message);
    },
  }),
});

self.onmessage = (event) => {
  const command = event.data?.command;
  const handler = registeredCommands.get(command);
  if (!handler) return;
  Promise.resolve().then(() => handler())
    .catch((error) => self.postMessage({
      type: "command-error",
      command,
      message: String(error?.message || error).slice(0, 500),
    }));
};

(async () => {
  try {
    const sourceUrl = URL.createObjectURL(new Blob([extensionSource], { type: "text/javascript" }));
    try {
      importScripts(sourceUrl);
    } finally {
      URL.revokeObjectURL(sourceUrl);
    }
    if (!self.skylineExtension || typeof self.skylineExtension.activate !== "function") {
      throw new Error("The extension must define skylineExtension.activate(api).");
    }
    await self.skylineExtension.activate(api);
    self.postMessage({ type: "activated" });
  } catch (error) {
    self.postMessage({
      type: "activation-error",
      message: String(error?.message || error).slice(0, 500),
    });
  }
})();
`;

const createExtensionHostDocument = () => `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' blob:; worker-src blob:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">
  <title>Skyline Extension Host</title>
</head>
<body>
  <script>
    let extensionWorker = null;
    window.skylineExtensionHost.onStart(({ workerSource }) => {
      if (extensionWorker) extensionWorker.terminate();
      const workerUrl = URL.createObjectURL(new Blob([workerSource], { type: "text/javascript" }));
      extensionWorker = new Worker(workerUrl);
      extensionWorker.onmessage = (event) => window.skylineExtensionHost.postMessage(event.data);
      extensionWorker.onerror = (event) => {
        window.skylineExtensionHost.postMessage({
          type: "activation-error",
          message: String(event.message || "Extension worker failed").slice(0, 500),
        });
      };
      URL.revokeObjectURL(workerUrl);
    });
    window.skylineExtensionHost.onCommand(({ command }) => {
      extensionWorker?.postMessage({ command });
    });
  </script>
</body>
</html>`;

module.exports = { createExtensionHostDocument, createExtensionWorkerSource };
