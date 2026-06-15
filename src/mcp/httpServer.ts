import type { JsonValue } from "../codex/types";
import {
  MCP_PROTOCOL_VERSION,
  createJsonRpcError,
  createJsonRpcResult,
  getJsonRpcId,
  isJsonObject,
  type McpTool,
  type McpToolCallResult,
} from "./protocol";
import { createPaperReadTool } from "./tools/paperRead";
import { createLogger } from "../utils/logger";

export {
  MCP_ENDPOINT_PATH,
  createMcpHttpHandler,
  shutdownMcpHttpServer,
  startMcpHttpServer,
};

const MCP_ENDPOINT_PATH = "/zopilot/mcp";
const DEFAULT_ZOTERO_HTTP_PORT = 23119;
const SERVER_NAME = "zopilot";
const SERVER_TITLE = "Zopilot";
const SERVER_VERSION = "0.0.0";

type McpHttpServerInfo = {
  name: string;
  url: string;
  token: string;
};

type McpHttpHandlerOptions = {
  token: string;
  paperReadTool: McpTool;
  logger?: McpHttpLogCallback;
};

type McpHttpLogCallback = (message: string, details?: JsonValue) => void;

type McpHttpRequest = {
  method: string;
  headers: Record<string, string>;
  data: unknown;
};

type McpHttpResponse = {
  status: number;
  headers: Record<string, string>;
  body?: string;
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
          await callToolFromJsonRpc(message.params, paperReadTool, logger),
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
  const result = await paperReadTool.call(params.arguments);
  logger.debug("mcp.tool.call.finish", {
    name,
    isError: Boolean(result.isError),
    durationMs: Date.now() - startedAt,
  });
  return result;
}

function validateRequestSecurity(
  request: McpHttpRequest,
  token: string,
): string | undefined {
  const authorization = getHeader(request.headers, "authorization");
  if (authorization !== `Bearer ${token}`) {
    return "Invalid MCP Authorization header.";
  }

  const host = getHeader(request.headers, "host");
  if (host && !isAllowedHost(host)) {
    return `Rejected MCP Host header: ${host}`;
  }

  const origin = getHeader(request.headers, "origin");
  if (origin && !isAllowedOrigin(origin)) {
    return `Rejected MCP Origin header: ${origin}`;
  }

  return undefined;
}

function isAllowedHost(host: string): boolean {
  const normalized = host.toLowerCase();
  return (
    normalized.startsWith("127.0.0.1:") || normalized.startsWith("localhost:")
  );
}

function isAllowedOrigin(origin: string): boolean {
  if (origin === "null") {
    return true;
  }
  try {
    const parsed = new URL(origin);
    return (
      parsed.protocol === "http:" &&
      (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost")
    );
  } catch {
    return false;
  }
}

function parseRequestBody(data: unknown):
  | { ok: true; value: JsonValue }
  | {
      ok: false;
      error: string;
    } {
  if (typeof data === "string") {
    try {
      return {
        ok: true,
        value: JSON.parse(data) as JsonValue,
      };
    } catch (error) {
      return {
        ok: false,
        error: `Invalid JSON body: ${String(error)}`,
      };
    }
  }
  if (isJsonObject(data) || Array.isArray(data)) {
    return {
      ok: true,
      value: data as JsonValue,
    };
  }
  return {
    ok: false,
    error: "MCP request body must be JSON.",
  };
}

function jsonResponse(status: number, body: JsonValue): McpHttpResponse {
  return {
    status,
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  };
}

function getHeader(
  headers: Record<string, string>,
  name: string,
): string | undefined {
  const direct = headers[name];
  if (direct !== undefined) {
    return direct;
  }
  const foundKey = Object.keys(headers).find(
    (key) => key.toLowerCase() === name.toLowerCase(),
  );
  return foundKey ? headers[foundKey] : undefined;
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
