import type { JsonObject } from "../mcp/protocol";
import { startMcpHttpServer } from "../mcp/httpServer";

export { buildCodexMcpServersConfig };

async function buildCodexMcpServersConfig(): Promise<JsonObject> {
  const server = await startMcpHttpServer();
  return {
    [server.name]: {
      url: server.url,
      http_headers: {
        Authorization: `Bearer ${server.token}`,
      },
      enabled_tools: ["paper_read"],
      startup_timeout_sec: 10,
      tool_timeout_sec: 60,
    },
  };
}
