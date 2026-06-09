export { buildCodexDeveloperInstructions };

function buildCodexDeveloperInstructions(): string {
  return [
    "Use `paper_read` when you need information from the paper.",
    "Do not describe MCP tools, tool calls, or internal workflow.",
  ].join("\n");
}
