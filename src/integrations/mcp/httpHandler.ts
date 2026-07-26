import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { JsonValue } from "../../runtime/json/types";
import { createLogger } from "../../runtime/logging/logger";
import type { PaperReadService } from "../../application/document/PaperReadService";
import {
  registerPaperReadTool,
  type RegisterPaperReadToolOptions,
} from "./tools/paperRead";
import {
  errorResponse,
  fromWebResponse,
  toWebRequest,
  validateRequestSecurity,
  type McpHttpRequest,
  type McpHttpResponse,
} from "./httpTransport";

const SERVER_INFO = {
  name: "zopilot",
  title: "Zopilot",
  version: "0.7.8",
};
const mcpLogger = createLogger("mcp.http");

type McpHttpHandlerOptions = {
  token: string;
  paperReadService?: PaperReadService;
  readFile?: RegisterPaperReadToolOptions["readFile"];
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
      registerPaperReadTool(server, {
        service: options.paperReadService,
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
