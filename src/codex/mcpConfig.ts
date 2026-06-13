import type { JsonValue } from "./types";
import { startMcpHttpServer } from "../mcp/httpServer";

export { buildCodexMcpServersConfig };

async function buildCodexMcpServersConfig(): Promise<
  Record<string, JsonValue>
> {
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
