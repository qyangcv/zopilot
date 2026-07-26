import type { JsonValue } from "../../runtime/json/types";
import type { ConversationMetadata } from "../../domain/conversation";
import { buildZopilotMcpConnection } from "../mcp/connection";

export { buildCodexMcpServersConfig };

async function buildCodexMcpServersConfig(
  conversation: ConversationMetadata,
): Promise<Record<string, JsonValue>> {
  const result = await buildZopilotMcpConnection(conversation, {
    acceptsImages: true,
    timeoutMs: 60000,
  });
  if (result.status === "disabled") return {};
  const connection = result.connection;
  return {
    [connection.serverName]: {
      url: connection.url,
      http_headers: connection.headers,
      enabled_tools: ["paper_read"],
      startup_timeout_sec: 10,
      tool_timeout_sec: Math.ceil(connection.timeoutMs / 1000),
    },
  };
}
