import type { JsonValue } from "../codex/types";

export {
  MCP_PROTOCOL_VERSION,
  createJsonRpcError,
  createJsonRpcResult,
  getJsonRpcId,
  isJsonObject,
};
export type {
  JsonObject,
  McpContent,
  McpHttpRequest,
  McpHttpResponse,
  McpTool,
  McpToolCallResult,
  McpToolDefinition,
};

const MCP_PROTOCOL_VERSION = "2025-06-18";

type JsonObject = { [key: string]: JsonValue };

type McpHttpRequest = {
  method: string;
  pathname: string;
  headers: Record<string, string>;
  data: unknown;
};

type McpHttpResponse = {
  status: number;
  headers?: Record<string, string>;
  body?: string;
};

type McpContent = {
  type: "text";
  text: string;
};

type McpToolDefinition = {
  name: string;
  title?: string;
  description: string;
  inputSchema: JsonObject;
  annotations?: JsonObject;
};

type McpToolCallResult = {
  content: McpContent[];
  structuredContent?: JsonValue;
  isError?: boolean;
  _meta?: JsonObject;
};

type McpTool = {
  definition: McpToolDefinition;
  call(input: JsonValue | undefined): Promise<McpToolCallResult>;
};

function createJsonRpcResult(id: JsonValue, result: JsonValue): JsonObject {
  return {
    jsonrpc: "2.0",
    id,
    result,
  };
}

function createJsonRpcError(
  id: JsonValue,
  code: number,
  message: string,
  data?: JsonValue,
): JsonObject {
  const error: JsonObject = {
    code,
    message,
  };
  if (data !== undefined) {
    error.data = data;
  }
  return {
    jsonrpc: "2.0",
    id,
    error,
  };
}

function getJsonRpcId(message: unknown): JsonValue {
  if (!isJsonObject(message)) {
    return null;
  }
  const id = message.id;
  return typeof id === "string" || typeof id === "number" || id === null
    ? id
    : null;
}

function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
