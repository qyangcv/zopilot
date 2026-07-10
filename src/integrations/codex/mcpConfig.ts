import type { JsonValue } from "../../runtime/json/types";
import type { ConversationMetadata } from "../../domain/conversation";
import { startMcpHttpServer } from "../mcp/httpServer";
import { createPaperBindingHeaders } from "../mcp/workspaceBinding";

export { buildCodexMcpServersConfig };

async function buildCodexMcpServersConfig(
  conversation: ConversationMetadata,
): Promise<Record<string, JsonValue>> {
  const server = await startMcpHttpServer();
  return {
    [server.name]: {
      url: server.url,
      http_headers: {
        Authorization: `Bearer ${server.token}`,
        ...createPaperBindingHeaders(conversation),
      },
      enabled_tools: ["paper_read"],
      startup_timeout_sec: 10,
      tool_timeout_sec: 60,
    },
  };
}
