import { createPaperReadTool } from "./tools/paperRead";
import { createLogger } from "../../runtime/logging/logger";
import { createMcpHttpHandler } from "./httpHandler";
export { createMcpHttpHandler } from "./httpHandler";

export { MCP_ENDPOINT_PATH, shutdownMcpHttpServer, startMcpHttpServer };

const MCP_ENDPOINT_PATH = "/zopilot/mcp";
const DEFAULT_ZOTERO_HTTP_PORT = 23119;
const SERVER_NAME = "zopilot";

type McpHttpServerInfo = {
  name: string;
  url: string;
  token: string;
};

let serverInfo: McpHttpServerInfo | undefined;
let endpointRegistered = false;
const mcpLogger = createLogger("mcp.http");

async function startMcpHttpServer(): Promise<McpHttpServerInfo> {
  if (serverInfo && endpointRegistered) {
    return serverInfo;
  }

  const token = createSessionToken();
  const port = getZoteroHttpPort();
  const info: McpHttpServerInfo = {
    name: SERVER_NAME,
    url: `http://127.0.0.1:${port}${MCP_ENDPOINT_PATH}`,
    token,
  };
  const handler = createMcpHttpHandler({
    token,
    paperReadTool: createPaperReadTool(),
  });

  const endpointHandler = async (
    request: _ZoteroTypes.Server.initMethodPromise extends (
      options: infer Options,
    ) => unknown
      ? Options
      : never,
  ): Promise<[number, Record<string, string>, string] | number> => {
    const response = await handler.handle({
      method: request.method,
      headers: request.headers,
      data: request.data,
    });
    if (!response.body) {
      return [response.status, response.headers, ""];
    }
    return [response.status, response.headers, response.body];
  };

  class ZopilotMcpEndpoint {
    supportedMethods: Array<"POST"> = ["POST"];
    supportedDataTypes = ["application/json"];
    init = endpointHandler;
  }

  Zotero.Server.Endpoints[MCP_ENDPOINT_PATH] = ZopilotMcpEndpoint;
  serverInfo = info;
  endpointRegistered = true;

  mcpLogger.info("mcp.http.start", {
    url: info.url,
    path: MCP_ENDPOINT_PATH,
    port,
    endpoint: "Zotero.Server.Endpoints",
  });

  return info;
}

function shutdownMcpHttpServer(): void {
  if (endpointRegistered) {
    delete Zotero.Server.Endpoints[MCP_ENDPOINT_PATH];
    endpointRegistered = false;
  }
  if (serverInfo) {
    mcpLogger.info("mcp.http.stop", {
      url: serverInfo.url,
      path: MCP_ENDPOINT_PATH,
    });
  }
  serverInfo = undefined;
}

function getZoteroHttpPort(): number {
  const value = Zotero.Prefs.get("httpServer.port");
  return typeof value === "number" && Number.isInteger(value)
    ? value
    : DEFAULT_ZOTERO_HTTP_PORT;
}

function createSessionToken(): string {
  const randomUUID = globalThis.crypto?.randomUUID;
  if (!randomUUID) {
    throw new Error("Web Crypto randomUUID is unavailable.");
  }
  return randomUUID.call(globalThis.crypto);
}
