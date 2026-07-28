import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { JsonValue } from "../../runtime/json/types";
import { createLogger } from "../../runtime/logging/logger";
import type { PaperToolsService } from "../../application/document/PaperToolsService";
import {
  registerPaperTools,
  type RegisterPaperToolsOptions,
} from "./paperToolsAdapter";
import {
  errorResponse,
  fromWebResponse,
  toWebRequest,
  validateRequestSecurity,
  type McpHttpRequest,
  type McpHttpResponse,
} from "./httpTransport";
import { ZOPILOT_MCP_SERVER_NAME } from "./constants";

const SERVER_INFO = {
  name: ZOPILOT_MCP_SERVER_NAME,
  title: "Zopilot",
  version: "0.7.8",
};
const mcpLogger = createLogger("mcp.http");

type McpHttpHandlerOptions = {
  token: string;
  paperToolsService?: PaperToolsService;
  readFile?: RegisterPaperToolsOptions["readFile"];
  logger?: McpHttpLogCallback;
  url?: string;
};
type McpHttpLogCallback = (message: string, details?: JsonValue) => void;

function createMcpHttpHandler(options: McpHttpHandlerOptions) {
  const logger =
    options.logger ||
    ((message: string, details?: JsonValue) =>
      mcpLogger.debug(message, details));
  return {
    async handle(request: McpHttpRequest): Promise<McpHttpResponse> {
      const startedAt = Date.now();
      const securityError = validateRequestSecurity(request, options.token);
      if (securityError) {
        logger("mcp.http.reject", {
          reason: securityError,
          durationMs: Date.now() - startedAt,
        });
        return errorResponse(403, securityError);
      }

      const server = new McpServer(SERVER_INFO);
      registerPaperTools(server, {
        service: options.paperToolsService,
        readFile: options.readFile,
      });
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      try {
        await server.connect(transport);
        const response = await transport.handleRequest(
          toWebRequest(request, options.url || "http://127.0.0.1/zopilot/mcp"),
        );
        logger("mcp.http.response", {
          method: request.method,
          status: response.status,
          durationMs: Date.now() - startedAt,
        });
        return fromWebResponse(response);
      } catch (error) {
        mcpLogger.error("mcp.http.request.error", error, {
          method: request.method,
          durationMs: Date.now() - startedAt,
        });
        return errorResponse(500, "MCP request failed.");
      } finally {
        await server.close().catch(() => undefined);
      }
    },
  };
}

export { createMcpHttpHandler };
export type {
  McpHttpHandlerOptions,
  McpHttpLogCallback,
  McpHttpRequest,
  McpHttpResponse,
};
