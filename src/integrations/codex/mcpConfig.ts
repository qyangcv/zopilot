import type { JsonValue } from "../../runtime/json/types";
import type { ThreadRunInput } from "../../domain/thread";
import { buildZopilotMcpConnection } from "../mcp/connection";
import { ZOPILOT_PAPER_TOOL_NAMES } from "../../application/document/PaperTools";

export { buildCodexMcpServersConfig };

async function buildCodexMcpServersConfig(
  run: Pick<ThreadRunInput, "workspace" | "context">,
): Promise<Record<string, JsonValue>> {
  const result = await buildZopilotMcpConnection(run, {
    acceptsImages: true,
    timeoutMs: 60000,
  });
  if (result.status === "disabled") return {};
  const connection = result.connection;
  return {
    [connection.serverName]: {
      url: connection.url,
      http_headers: connection.headers,
      enabled_tools: [...ZOPILOT_PAPER_TOOL_NAMES],
      startup_timeout_sec: 10,
      tool_timeout_sec: Math.ceil(connection.timeoutMs / 1000),
    },
  };
}
