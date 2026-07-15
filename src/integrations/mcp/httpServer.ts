import { createPaperReadTool } from "./tools/paperRead";
import { createLogger } from "../../runtime/logging/logger";
import { createMcpHttpHandler } from "./httpHandler";
import { ZoteroServerEndpointRegistry } from "../zotero/compat/serverEndpointRegistry";
export { createMcpHttpHandler } from "./httpHandler";

export { MCP_ENDPOINT_PATH, shutdownMcpHttpServer, startMcpHttpServer };

const MCP_ENDPOINT_PATH = "/zopilot/mcp";
const DEFAULT_ZOTERO_HTTP_PORT = 23119;
const SERVER_NAME = "zopilot";

type McpHttpServerInfo = {
  status: "ready";
  name: string;
  url: string;
  token: string;
};

type McpHttpServerDisabled = {
  status: "disabled";
  diagnostic: {
    code: string;
    message: string;
  };
};

type McpHttpServerResult = McpHttpServerInfo | McpHttpServerDisabled;

let serverInfo: McpHttpServerInfo | undefined;
let disabledResult: McpHttpServerDisabled | undefined;
const endpointRegistry = new ZoteroServerEndpointRegistry();
const mcpLogger = createLogger("mcp.http");

async function startMcpHttpServer(): Promise<McpHttpServerResult> {
  if (serverInfo) {
    return serverInfo;
  }
  if (disabledResult) return disabledResult;

  let token: string;
  try {
    token = createSessionToken();
  } catch (error) {
    return disableMcp("crypto_unavailable", error);
  }
  try {
    return initializeMcpHttpServer(token);
  } catch (error) {
    endpointRegistry.unregister();
    serverInfo = undefined;
    return disableMcp("startup_failed", error);
  }
}

function initializeMcpHttpServer(token: string): McpHttpServerResult {
  const port = getZoteroHttpPort();
  const info: McpHttpServerInfo = {
    status: "ready",
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

  const registration = endpointRegistry.register(
    MCP_ENDPOINT_PATH,
    ZopilotMcpEndpoint,
  );
  if (!registration.ok) {
    return disableMcp(registration.code, registration.message);
  }
  serverInfo = info;

  mcpLogger.info("mcp.http.start", {
    url: info.url,
    path: MCP_ENDPOINT_PATH,
    port,
    endpoint: "zotero-compat-registry",
  });

  return info;
}

function shutdownMcpHttpServer(): void {
  endpointRegistry.unregister();
  if (serverInfo) {
    mcpLogger.info("mcp.http.stop", {
      url: serverInfo.url,
      path: MCP_ENDPOINT_PATH,
    });
  }
  serverInfo = undefined;
  disabledResult = undefined;
}

function disableMcp(code: string, error: unknown): McpHttpServerDisabled {
  const result: McpHttpServerDisabled = {
    status: "disabled",
    diagnostic: {
      code,
      message: error instanceof Error ? error.message : String(error),
    },
  };
  disabledResult = result;
  mcpLogger.warn("mcp.http.disabled", result.diagnostic);
  return result;
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
