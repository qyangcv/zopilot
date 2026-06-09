import type { JsonValue } from "../codex/types";
import type { McpTool, McpToolDefinition, McpToolCallResult } from "./protocol";
import { createPaperReadTool } from "./tools/paperRead";

export { McpToolRegistry, createDefaultMcpToolRegistry };

type ToolRegistryOptions = {
  logger?: (message: string, details?: JsonValue) => void;
};

class McpToolRegistry {
  private readonly tools = new Map<string, McpTool>();

  register(tool: McpTool): void {
    this.tools.set(tool.definition.name, tool);
  }

  listTools(): McpToolDefinition[] {
    return [...this.tools.values()].map((tool) => tool.definition);
  }

  async callTool(
    name: string,
    input: JsonValue | undefined,
  ): Promise<McpToolCallResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Unknown MCP tool: ${name}`);
    }
    return tool.call(input);
  }
}

function createDefaultMcpToolRegistry(
  options: ToolRegistryOptions = {},
): McpToolRegistry {
  const registry = new McpToolRegistry();
  registry.register(
    createPaperReadTool({
      logger: options.logger,
    }),
  );
  return registry;
}
