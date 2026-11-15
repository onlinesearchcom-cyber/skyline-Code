const agentTools = [
  {
    type: "function",
    function: {
      name: "search_workspace",
      description: "Search text in files in the currently open workspace.",
      parameters: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_workspace_file",
      description: "Read a text file from the currently open workspace.",
      parameters: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "propose_file_edit",
      description: "Prepare a complete replacement for an existing workspace file. The user must approve it before it is written.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          content: { type: "string" },
        },
        required: ["path", "content"],
      },
    },
  },
];

const toolNames = new Set(agentTools.map((tool) => tool.function.name));

const getOllamaModels = (payload) => {
  if (!payload || !Array.isArray(payload.models)) {
    throw new Error("Ollama returned an invalid model list.");
  }
  return payload.models
    .filter((model) =>
      model &&
      typeof model.name === "string" &&
      !model.name.endsWith(":cloud") &&
      Array.isArray(model.capabilities) &&
      model.capabilities.includes("tools"),
    )
    .map((model) => ({ name: model.name }));
};

const normalizeAgentMessages = (messages) => {
  if (!Array.isArray(messages) || messages.length > 40) {
    throw new Error("Agent conversation is invalid or too long.");
  }

  let totalSize = 0;
  return messages.map((message) => {
    if (!message || !["system", "user", "assistant", "tool"].includes(message.role) ||
        typeof message.content !== "string" || message.content.length > 40000) {
      throw new Error("Agent conversation contains an invalid message.");
    }
    totalSize += message.content.length;
    if (totalSize > 200000) throw new Error("Agent conversation exceeds the size limit.");

    if (message.role === "tool") {
      if (typeof message.tool_name !== "string" || !toolNames.has(message.tool_name)) {
        throw new Error("Agent conversation contains an invalid tool result.");
      }
      return { role: "tool", tool_name: message.tool_name, content: message.content };
    }

    if (message.role === "assistant" && message.tool_calls !== undefined) {
      if (!Array.isArray(message.tool_calls) || message.tool_calls.length > 5) {
        throw new Error("Agent conversation contains invalid tool calls.");
      }
      const toolCalls = message.tool_calls.map((call) => {
        const name = call?.function?.name;
        const args = call?.function?.arguments;
        if (!toolNames.has(name) ||
            (!args || typeof args !== "object" && typeof args !== "string")) {
          throw new Error("Agent conversation contains an invalid tool call.");
        }
        if ((typeof args === "object" && JSON.stringify(args).length > 16000) ||
            (typeof args === "string" && args.length > 16000)) {
          throw new Error("Agent tool arguments exceed the size limit.");
        }
        return {
          ...(typeof call.id === "string" ? { id: call.id.slice(0, 100) } : {}),
          type: "function",
          function: { name, arguments: args },
        };
      });
      return { role: "assistant", content: message.content, tool_calls: toolCalls };
    }

    return { role: message.role, content: message.content };
  });
};

const parseAgentToolCall = (call) => {
  const name = call?.function?.name;
  if (!toolNames.has(name)) throw new Error("The agent requested an unsupported workspace tool.");

  let args = call.function.arguments;
  if (typeof args === "string") {
    try {
      args = JSON.parse(args);
    } catch {
      throw new Error("The agent returned invalid tool arguments.");
    }
  }
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    throw new Error("The agent returned invalid tool arguments.");
  }

  if (name === "search_workspace" && typeof args.query === "string" &&
      args.query.trim() && args.query.length <= 200) {
    return { name, arguments: { query: args.query.trim() } };
  }
  if (name === "read_workspace_file" && typeof args.path === "string" &&
      args.path.length > 0 && args.path.length <= 500) {
    return { name, arguments: { path: args.path } };
  }
  if (name === "propose_file_edit" && typeof args.path === "string" &&
      args.path.length > 0 && args.path.length <= 500 &&
      typeof args.content === "string" && args.content.length <= 256 * 1024) {
    return { name, arguments: { path: args.path, content: args.content } };
  }
  throw new Error("The agent returned invalid tool arguments.");
};

module.exports = {
  agentTools,
  getOllamaModels,
  normalizeAgentMessages,
  parseAgentToolCall,
};
