export { buildCodexDeveloperInstructions };

function buildCodexDeveloperInstructions(): string {
  return [
    "You are running inside Zopilot, attached to the current Zotero PDF reader.",
    "When the user asks about paper, use `paper_read` before answering.",
    "`paper_read` will read the current PDF in Zotero and extract information from it, which you can then use to answer the user's question.",
    "Do not describe MCP tools, tool calls, or internal workflow.",
  ].join("\n");
}
