const validateEditorSettings = (settings) => {
  if (!settings || typeof settings !== "object" || Array.isArray(settings) ||
      !Number.isInteger(settings.fontSize) || settings.fontSize < 10 || settings.fontSize > 24 ||
      ![2, 4, 8].includes(settings.tabSize) || typeof settings.minimap !== "boolean" ||
      typeof settings.wordWrap !== "boolean") {
    throw new Error("Invalid workspace editor settings.");
  }
};

const parseWorkspaceEditorSettings = (contents) => {
  const stored = JSON.parse(contents);
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) {
    throw new Error(".vscode/settings.json must contain a JSON object.");
  }
  const hasSetting = (key) => Object.prototype.hasOwnProperty.call(stored, key);
  const settings = {};
  const fontSize = stored["editor.fontSize"];
  const tabSize = stored["editor.tabSize"];
  const minimapSetting = stored["editor.minimap"];
  const validMinimapSetting = minimapSetting == null || typeof minimapSetting === "boolean" ||
    (typeof minimapSetting === "object" && !Array.isArray(minimapSetting) &&
      (minimapSetting.enabled == null || typeof minimapSetting.enabled === "boolean"));
  const wordWrap = stored["editor.wordWrap"];

  if ((hasSetting("editor.fontSize") && (!Number.isInteger(fontSize) || fontSize < 10 || fontSize > 24)) ||
      (hasSetting("editor.tabSize") && ![2, 4, 8].includes(tabSize)) ||
      (hasSetting("editor.minimap") && !validMinimapSetting) ||
      (hasSetting("editor.wordWrap") && !["on", "off", "wordWrapColumn", "bounded"].includes(wordWrap))) {
    throw new Error(".vscode/settings.json contains unsupported editor settings.");
  }
  if (hasSetting("editor.fontSize")) settings.fontSize = fontSize;
  if (hasSetting("editor.tabSize")) settings.tabSize = tabSize;
  if (typeof minimapSetting === "boolean") settings.minimap = minimapSetting;
  else if (typeof minimapSetting?.enabled === "boolean") settings.minimap = minimapSetting.enabled;
  if (hasSetting("editor.wordWrap")) settings.wordWrap = wordWrap !== "off";
  return settings;
};

const serializeWorkspaceEditorSettings = (contents, settings) => {
  validateEditorSettings(settings);
  const stored = contents ? JSON.parse(contents) : {};
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) {
    throw new Error(".vscode/settings.json must contain a JSON object.");
  }

  stored["editor.fontSize"] = settings.fontSize;
  stored["editor.tabSize"] = settings.tabSize;
  stored["editor.minimap"] = {
    ...(stored["editor.minimap"] && typeof stored["editor.minimap"] === "object"
      ? stored["editor.minimap"]
      : {}),
    enabled: settings.minimap,
  };
  stored["editor.wordWrap"] = settings.wordWrap ? "on" : "off";
  return `${JSON.stringify(stored, null, 2)}\n`;
};

module.exports = {
  parseWorkspaceEditorSettings,
  serializeWorkspaceEditorSettings,
  validateEditorSettings,
};
