const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  getOllamaModels,
  normalizeAgentMessages,
  parseAgentToolCall,
} = require("./ai-agent.cjs");

test("only installed local Ollama models with tool support are offered", () => {
  assert.deepEqual(getOllamaModels({
    models: [
      { name: "llama3.2:latest", capabilities: ["completion", "tools"] },
      { name: "text-only", capabilities: ["completion"] },
      { name: "remote:cloud", capabilities: ["tools"] },
    ],
  }), [{ name: "llama3.2:latest" }]);
  assert.throws(() => getOllamaModels({}), /invalid model list/);
});

test("agent conversations accept only bounded message and tool shapes", () => {
  assert.deepEqual(normalizeAgentMessages([
    { role: "user", content: "Inspect this file." },
    {
      role: "assistant",
      content: "",
      tool_calls: [{
        type: "function",
        function: { name: "read_workspace_file", arguments: { path: "src\\App.jsx" } },
      }],
    },
    { role: "tool", tool_name: "read_workspace_file", content: "file contents" },
  ]), [
    { role: "user", content: "Inspect this file." },
    {
      role: "assistant",
      content: "",
      tool_calls: [{
        type: "function",
        function: { name: "read_workspace_file", arguments: { path: "src\\App.jsx" } },
      }],
    },
    { role: "tool", tool_name: "read_workspace_file", content: "file contents" },
  ]);
  assert.throws(() => normalizeAgentMessages([{ role: "system", content: "x".repeat(40001) }]), /invalid message/);
  assert.throws(() => normalizeAgentMessages([{ role: "tool", tool_name: "run_shell", content: "" }]), /invalid tool result/);
});

test("agent tool arguments are checked before workspace access", () => {
  assert.deepEqual(parseAgentToolCall({
    function: { name: "search_workspace", arguments: '{"query":"  TODO  "}' },
  }), { name: "search_workspace", arguments: { query: "TODO" } });
  assert.deepEqual(parseAgentToolCall({
    function: { name: "propose_new_file", arguments: { path: "src\\tool.js", content: "export {};" } },
  }), { name: "propose_new_file", arguments: { path: "src\\tool.js", content: "export {};" } });
  assert.throws(() => parseAgentToolCall({
    function: { name: "run_shell", arguments: {} },
  }), /unsupported workspace tool/);
  assert.throws(() => parseAgentToolCall({
    function: { name: "propose_new_file", arguments: { path: "src/tool.js", content: "x".repeat(300000) } },
  }), /invalid tool arguments/);
  assert.throws(() => parseAgentToolCall({
    function: { name: "propose_file_edit", arguments: { path: "src/App.jsx", content: "x".repeat(300000) } },
  }), /invalid tool arguments/);
});
