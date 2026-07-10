import type { JsonValue } from "../../runtime/json/types";
import { createLogger } from "../../runtime/logging/logger";
import {
  MCP_PROTOCOL_VERSION,
  createJsonRpcError,
  createJsonRpcResult,
  getJsonRpcId,
  isJsonObject,
  type McpToolCallContext,
  type McpTool,
  type McpToolCallResult,
} from "./protocol";
import { parsePaperBindingHeaders } from "./workspaceBinding";
import {
  jsonResponse,
  parseRequestBody,
  validateRequestSecurity,
  type McpHttpRequest,
  type McpHttpResponse,
} from "./httpTransport";

const SERVER_NAME = "zopilot";
const SERVER_TITLE = "Zopilot";
const SERVER_VERSION = "0.0.0";
const mcpLogger = createLogger("mcp.http");

type McpHttpHandlerOptions = {
  token: string;
  paperReadTool: McpTool;
  logger?: McpHttpLogCallback;
};
type McpHttpLogCallback = (message: string, details?: JsonValue) => void;

function createMcpHttpHandler(options: McpHttpHandlerOptions) {
  const logger = createMcpRequestLogger(options.logger);
  return {
    async handle(request: McpHttpRequest): Promise<McpHttpResponse> {
      const startedAt = Date.now();
      if (request.method !== "POST") {
        return jsonResponse(405, {
          error: "MCP endpoint only accepts POST requests.",
        });
      }

      const securityError = validateRequestSecurity(request, options.token);
      if (securityError) {
        logger.warn("mcp.http.reject", {
          reason: securityError,
          durationMs: Date.now() - startedAt,
        });
        return jsonResponse(403, {
          error: securityError,
        });
      }

      const parseResult = parseRequestBody(request.data);
      if (!parseResult.ok) {
        logger.warn("mcp.http.invalid_json", {
          error: parseResult.error,
          durationMs: Date.now() - startedAt,
        });
        return jsonResponse(
          400,
          createJsonRpcError(null, -32700, parseResult.error),
        );
      }

      const messages = Array.isArray(parseResult.value)
        ? parseResult.value
        : [parseResult.value];
      const responses: JsonValue[] = [];

      for (const message of messages) {
        const response = await handleJsonRpcMessage(
          message,
          options.paperReadTool,
          createToolCallContext(request.headers),
          logger,
          startedAt,
        );
        if (response) {
          responses.push(response);
        }
      }

      if (!responses.length) {
        return {
          status: 202,
          headers: {
            "Content-Type": "application/json",
          },
        };
      }

      logger.debug("mcp.http.response", {
        count: responses.length,
        durationMs: Date.now() - startedAt,
      });
      return jsonResponse(
        200,
        Array.isArray(parseResult.value) ? responses : responses[0],
      );
    },
  };
}

async function handleJsonRpcMessage(
  message: unknown,
  paperReadTool: McpTool,
  context: McpToolCallContext,
  logger: McpRequestLogger,
  requestStartedAt: number,
): Promise<JsonValue | undefined> {
  if (!isJsonObject(message)) {
    return createJsonRpcError(null, -32600, "Invalid JSON-RPC message.");
  }
  const id = getJsonRpcId(message);
  const method = typeof message.method === "string" ? message.method : "";
  const hasId = Object.hasOwn(message, "id");

  logger.debug("mcp.http.request", {
    id,
    method: method || "(missing)",
  });

  if (!method) {
    return createJsonRpcError(id, -32600, "JSON-RPC method is required.");
  }

  if (!hasId && method === "initialized") {
    logger.debug("mcp.lifecycle.initialized", {
      durationMs: Date.now() - requestStartedAt,
    });
    return undefined;
  }

  try {
    switch (method) {
      case "initialize":
        return createJsonRpcResult(id, {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: {
            tools: {},
          },
          serverInfo: {
            name: SERVER_NAME,
            title: SERVER_TITLE,
            version: SERVER_VERSION,
          },
        });
      case "ping":
        return createJsonRpcResult(id, {});
      case "tools/list":
        return createJsonRpcResult(id, {
          tools: [paperReadTool.definition],
        });
      case "tools/call":
        return createJsonRpcResult(
          id,
          await callToolFromJsonRpc(
            message.params,
            paperReadTool,
            context,
            logger,
          ),
        );
      default:
        return createJsonRpcError(
          id,
          -32601,
          `Unsupported MCP method: ${method}`,
        );
    }
  } catch (error) {
    logger.error("mcp.http.request.error", error, {
      id,
      method,
      durationMs: Date.now() - requestStartedAt,
    });
    return createJsonRpcError(id, -32602, String(error));
  }
}

async function callToolFromJsonRpc(
  params: JsonValue | undefined,
  paperReadTool: McpTool,
  context: McpToolCallContext,
  logger: McpRequestLogger,
): Promise<McpToolCallResult> {
  if (!isJsonObject(params)) {
    throw new Error("tools/call params must be an object.");
  }
  const name = params.name;
  if (typeof name !== "string") {
    throw new Error("tools/call params.name must be a string.");
  }

  const startedAt = Date.now();
  logger.debug("mcp.tool.call.start", {
    name,
  });
  if (name !== paperReadTool.definition.name) {
    throw new Error(`Unknown MCP tool: ${name}`);
  }
  const result = await paperReadTool.call(params.arguments, context);
  logger.debug("mcp.tool.call.finish", {
    name,
    isError: Boolean(result.isError),
    durationMs: Date.now() - startedAt,
  });
  return result;
}

function createToolCallContext(
  headers: Record<string, string>,
): McpToolCallContext {
  const binding = parsePaperBindingHeaders(headers);
  if (binding.ok) {
    return {
      workspaceScope: binding.value,
    };
  }
  return {
    paperBindingError: binding.error,
  };
}

type McpRequestLogger = {
  debug(message: string, details?: JsonValue): void;
  warn(message: string, details?: JsonValue): void;
  error(message: string, error: unknown, details?: JsonValue): void;
};

function createMcpRequestLogger(
  callback?: McpHttpLogCallback,
): McpRequestLogger {
  if (callback) {
    return {
      debug: callback,
      warn: callback,
      error(message, error, details) {
        callback(message, mergeErrorDetails(error, details));
      },
    };
  }
  return {
    debug: (message, details) => mcpLogger.debug(message, details),
    warn: (message, details) => mcpLogger.warn(message, details),
    error: (message, error, details) =>
      mcpLogger.error(message, error, details),
  };
}

function mergeErrorDetails(error: unknown, details?: JsonValue): JsonValue {
  const payload: { [key: string]: JsonValue } = {
    error: String(error),
  };
  if (details && typeof details === "object" && !Array.isArray(details)) {
    return {
      ...details,
      error: payload.error,
    };
  }
  if (details !== undefined) {
    payload.details = details;
  }
  return payload;
}

export { createMcpHttpHandler };
export type {
  McpHttpHandlerOptions,
  McpHttpLogCallback,
  McpHttpRequest,
  McpHttpResponse,
};
